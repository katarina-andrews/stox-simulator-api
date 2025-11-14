import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const STOCKS = "Stocks";
const PORTFOLIO = "Portfolio";

// price of stock changes randomly
const updateStockPrices = async () => {
  const stocks = await docClient.send(new ScanCommand({ TableName: STOCKS }));
  const now = Date.now();

  for (const stock of stocks.Items) {
    const last = new Date(stock.lastUpdated || 0).getTime();
    if (now - last < 60000) continue; // skip if updated in the last 60 seconds, too many requests while testing

    const newPrice = parseFloat(
      (stock.price * (1 + (Math.random() - 0.5) / 200)).toFixed(2)
    );
    const changePercent = parseFloat(
      (((newPrice - stock.price) / stock.price) * 100).toFixed(2)
    );

    await docClient.send(
      new UpdateCommand({
        TableName: STOCKS,
        Key: { symbol: stock.symbol },
        UpdateExpression:
          "set price = :p, changePercent = :c, lastUpdated = :u",
        ExpressionAttributeValues: {
          ":p": newPrice,
          ":c": changePercent,
          ":u": new Date().toISOString(),
        },
      })
    );
  }
};

const getPortfolio = async (userId) => {
  const result = await docClient.send(
    new GetCommand({ TableName: PORTFOLIO, Key: { userId } })
  );

  if (!result.Item) {
    throw new Error("Portfolio not found");
  }

  return result.Item;
};

export const handler = async (event) => {
  console.log("HANDLER EVENT:", JSON.stringify(event));
  const headers = { "Content-Type": "application/json" };

  try {
    await updateStockPrices();

    const { rawPath, body, queryStringParameters } = event;
    const httpMethod = event.requestContext?.http?.method;
    const qp = queryStringParameters || {};

    // userId from cognito JWT for protected routes
    const claims = event.requestContext?.authorizer?.jwt?.claims;
    const userId = claims?.sub;

    const protectedRoutes = [
      "/portfolio",
      "/buy",
      "/sell",
      "/transactions",
      "/add-cash",
    ];
    const isProtected = protectedRoutes.includes(rawPath);

    if (isProtected && !userId) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: "Invalid token: not authorized" }),
      };
    }

    // GET /stocks
    if (httpMethod === "GET" && rawPath === "/stocks") {
      const result = await docClient.send(
        new ScanCommand({ TableName: STOCKS })
      );

      const orderedStocks = result.Items.map((stock) => ({
        symbol: stock.symbol,
        name: stock.name,
        price: stock.price,
        changePercent: stock.changePercent,
        lastUpdated: stock.lastUpdated,
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(orderedStocks),
      };
    }

    // GET /portfolio
    if (httpMethod === "GET" && rawPath === "/portfolio") {
      const result = await docClient.send(
        new GetCommand({ TableName: PORTFOLIO, Key: { userId } })
      );
      if (!result.Item) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "Portfolio not found" }),
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result.Item),
      };
    }

    // POST /add-cash
    if (httpMethod === "POST" && rawPath === "/add-cash") {
      if (!userId) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: "Not authorized" }),
        };
      }

      const { amount } = JSON.parse(body);
      const parsedAmount = Number(amount);

      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Invalid amount" }),
        };
      }

      const result = await docClient.send(
        new GetCommand({
          TableName: PORTFOLIO,
          Key: { userId },
        })
      );

      const now = new Date().toISOString();

      const portfolio = result.Item || {
        userId,
        cashBalance: 0,
        holdings: {},
        history: [],
      };

      portfolio.cashBalance += parsedAmount;
      portfolio.history.push({
        type: "add_cash",
        amount: parsedAmount,
        date: now,
      });

      await docClient.send(
        new PutCommand({
          TableName: PORTFOLIO,
          Item: portfolio,
        })
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(portfolio),
      };
    }

    // GET /transactions
    if (httpMethod === "GET" && rawPath === "/transactions") {
      const portfolio = await getPortfolio(userId);
      const history = portfolio.history || [];

      // newest first
      const sorted = history
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          transactions: sorted,
        }),
      };
    }

    // POST /buy
    if (httpMethod === "POST" && rawPath === "/buy") {
      const { ticker, quantity } = JSON.parse(body);
      const qty = Number(quantity);

      if (!ticker || !Number.isInteger(qty) || qty <= 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Invalid ticker or quantity" }),
        };
      }

      const stockResult = await docClient.send(
        new GetCommand({ TableName: STOCKS, Key: { symbol: ticker } })
      );

      if (!stockResult.Item) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "Stock not found" }),
        };
      }

      const price = stockResult.Item.price;
      const totalCost = price * qty;

      const portfolio = await getPortfolio(userId);

      if (portfolio.cashBalance < totalCost) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Insufficient funds" }),
        };
      }

      portfolio.cashBalance -= totalCost;
      portfolio.holdings[ticker] = (portfolio.holdings[ticker] || 0) + qty;

      portfolio.history.push({
        type: "buy",
        ticker,
        quantity: qty,
        price,
        total: totalCost,
        date: new Date().toISOString(),
      });

      await docClient.send(
        new PutCommand({ TableName: PORTFOLIO, Item: portfolio })
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(portfolio),
      };
    }

    // POST /sell
    if (httpMethod === "POST" && rawPath === "/sell") {
      const { ticker, quantity } = JSON.parse(body);
      const qty = Number(quantity);

      if (!ticker || !Number.isInteger(qty) || qty <= 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Invalid ticker or quantity" }),
        };
      }

      const portfolio = await getPortfolio(userId);
      const currentQty = portfolio.holdings[ticker] || 0;

      if (currentQty < qty) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Insufficient holdings" }),
        };
      }

      const stockResult = await docClient.send(
        new GetCommand({ TableName: STOCKS, Key: { symbol: ticker } })
      );

      if (!stockResult.Item) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "Stock not found" }),
        };
      }

      const price = stockResult.Item.price;
      const totalProceeds = price * qty;

      portfolio.cashBalance += totalProceeds;

      portfolio.holdings[ticker] = currentQty - qty;
      if (portfolio.holdings[ticker] === 0) {
        delete portfolio.holdings[ticker];
      }

      portfolio.history.push({
        type: "sell",
        ticker,
        quantity: qty,
        price,
        total: totalProceeds,
        date: new Date().toISOString(),
      });

      await docClient.send(
        new PutCommand({ TableName: PORTFOLIO, Item: portfolio })
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(portfolio),
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: "Unsupported route" }),
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
