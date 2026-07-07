# P2P Crypto Exchange — Telegram Mini App

> Buy and sell USDT directly in Telegram. No KYC. No passport. Escrow guarantee.

[![Bot](https://img.shields.io/badge/Telegram-@SergGOrelyyBot-blue)](https://t.me/SergGOrelyyBot)
[![API](https://img.shields.io/badge/API-p2p--exchange--api.vercel.app-green)](https://p2p-exchange-api.vercel.app/api/health)
[![License](https://img.shields.io/badge/license-MIT-purple)](LICENSE)

## P2P Exchange | USDT/RUB | Telegram Bot | No KYC | Escrow | TON Connect

**Keywords:** P2P обменник, купить USDT, продать USDT, p2p exchange telegram, криптообменник без паспорта, crypto p2p no kyc, USDT RUB exchange, escrow smart contract, Telegram Mini App, TON blockchain

## Features

- Buy/Sell USDT with RUB via SBP, T-Bank, Sberbank
- 5 security layers without KYC
- Maker bonds (500 USDT deposit against fraud)
- TrustScore matrix (TG account age, deals, disputes)
- Card fingerprint verification (SHA-256, no passport needed)
- Non-custodial escrow (smart contract on TON blockchain)
- AML scanner (wallet risk check)
- Referral program (0.5% from invited users)
- TradingView charts (Binance live rates)
- TON Connect wallet integration
- Telegram Stars payments
- Admin panel with arbitration

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML/CSS/JS, Telegram WebApp SDK, TON Connect UI, TradingView |
| Backend | Node.js, 37 API endpoints, Vercel Serverless |
| Database | PostgreSQL 16 (15 tables) |
| Blockchain | TON (FunC smart contract), toncenter API |
| Security | HMAC-SHA256, SERIALIZABLE isolation, SELECT FOR UPDATE |

## Quick Start

```bash
# Backend
cd backend
npm install
DATABASE_URL=postgres://... node api/index.js

# Frontend
cd frontend
npx serve .
```

## API Endpoints (37 total)

| Group | Endpoints | Description |
|-------|-----------|-------------|
| Auth | `/auth` | Telegram initData HMAC validation |
| Offers | `/offers` GET/POST/DELETE | P2P order book |
| Deals | `/deals` GET/POST/ lock/paid/release/dispute | Escrow flow |
| TON | `/ton/transfer` `/ton/verify` | Blockchain transactions |
| Security | `/bonds/*` `/scoring/*` `/cards/*` `/aml/*` | 5 security layers |
| Referrals | `/referrals` | Affiliate program |
| Admin | `/admin/deals` `/admin/disputes` | Arbitration |
| Charts | `/rates` `/commission` `/stats` | Live data |

## Security (No-KYC)

1. **Maker Bonds** — sellers deposit 500 USDT. Fraud = confiscation
2. **TrustScore** — 0-100 based on TG age, deals, disputes. Quarantine < 10 deals
3. **Card Hashes** — SHA-256(first6 + last4). Verify without passport
4. **Web3 Escrow** — USDT locked in smart contract, not on server
5. **AML Scanner** — wallet risk check. Blacklist high-risk addresses

## Referral Program

Every user gets a referral link. Earn 0.5% from every deal made by invited users.

## Architecture

```
Telegram Bot (@SergGOrelyyBot)
  → Mini App (HTML/CSS/JS)
    → API (Node.js + Vercel)
      → PostgreSQL (15 tables)
      → TON Blockchain (escrow smart contract)
      → toncenter API (transaction verification)
```

## Links

- Telegram Bot: [@SergGOrelyyBot](https://t.me/SergGOrelyyBot)
- Live Demo: [p2p-exchange-sigma.vercel.app](https://p2p-exchange-sigma.vercel.app)
- API: [p2p-exchange-api.vercel.app](https://p2p-exchange-api.vercel.app/api/health)
- GitHub: [Leonov792/p2p-exchange](https://github.com/Leonov792/p2p-exchange)
