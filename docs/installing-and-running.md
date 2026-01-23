# How to Run the Referral-pulse-campaign repo

This README.md file explains how to run Referral-pulse-campaign repo that requires downloading and installing the following repository: [https://github.com/Digital-Rogue-Wave/referral-pulse-development.git](https://github.com/Digital-Rogue-Wave/referral-pulse-development.git). After downloading this repository, you will need to set up environment variables in the `.env` file and then run the app using `npm run start:dev`.

## Prerequisites

Before you can run the Nest project, make sure you have the following prerequisites installed:

- [Docker](https://www.docker.com/get-started)
- [Docker Compose](V2 is included with all currently supported versions of Docker Desktop)
- [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/)

## Getting Started

Follow these steps to set up and run the Nest project:

### 1. Clone the Repository

First, clone the `referral-pulse-development` repository to your local machine:

```bash
git clone https://github.com/Digital-Rogue-Wave/referral-pulse-development.git
```

### 2. Run Docker Compose

Navigate to the downloaded repository directory and use docker-compose to start the necessary services. This assumes you have Docker installed.

```bash
cd referral-pulse-development/local
docker-compose up --build
```

Create database if not exists
```bash
chmod +x ./start-timescale.sh && docker exec -it timescaledb /usr/local/bin/start-timescale.sh
```
### 3. Download the repo and Update Environment Variables

Clone the `referral-pulse-campaign` repository to your local machine:

```bash
git clone https://github.com/Digital-Rogue-Wave/referral-pulse-campaign.git
cd referral-pulse-campaign-ms
```

Copy the env variable located in the env.example file.

```bash
cp env.example .env
```

### 4. Install packages

Install the packages using pnpm (if you have referral-pulse-domains in you local machine, you can replace "referral-pulse-domains": "file:../referral-pulse-domains" in the package.json file):

```bash
pnpm install
```

### 5. Start the nest server

Now, you can start the Nest app using npm:

```bash
pnpm start:dev
```
### Remark
Ensure that the connexion with the database as well as the kafka server sere established through the terminal

---

Previous: [Main](readme.md)

Next: [Working with database](database.md)
