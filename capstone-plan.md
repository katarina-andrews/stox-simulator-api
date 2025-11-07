# Capstone plan

## Project Description and Purpose

This app is for people that want a safe environment to practice stock trading without the risk of losing real money. You can try different strategies and track your performance. This would be for beginner investors or anyone that wants to learn in a gamified manner. 

## Planned Backend

AWS Lambda + API Gateway + DynamoDB

## API Routes and Methods

- GET /stocks → return all current stock prices
- GET /portfolio → get user’s portfolio and cash balance
- GET /transactions → get user’s transaction history
- POST /buy → buy stock
- POST /sell → sell stock

## Frontend Features and Pages

- login/register page 
- dashboard (shows stocks, portfolio, transactions)

## Authentication Flow

Amazon Cognito. The dashboard will be protected because you have to be logged in. 

## Deployment Plan

- Frontend → AWS S3 + CloudFront
- Backend → AWS Lambda + API Gateway
- Database → DynamoBD

## NPM Libraries / Tools
- vite → `npm create vite@latest`
- tailwindcss → `npm install tailwindcss @tailwindcss/vite`
- recharts → `npm install recharts` OR chart.js → `npm install chart.js react-chartjs-2`
- axios → `npm install axios`
- OIDC → `npm install oidc-client-ts react-oidc-context`


 


