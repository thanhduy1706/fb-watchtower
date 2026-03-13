# 🛰️ fb-watchtower

**Facebook Page monitoring system built with a high-resilience, multi-agent architecture.**

`fb-watchtower` is an enterprise-grade solution for near-real-time monitoring of public Facebook Pages. It utilizes a distributed multi-agent system to autonomously observe, reason, and notify when new content is detected, bypassing common scraping hurdles like login walls and dynamic rendering.

---

## 🏗️ Multi-Agent Architecture

`fb-watchtower` is designed with modularity in mind. Its intelligence is decentralized across several specialized agents communicating via a central **Event Bus**:

-   **📡 Monitoring Agent**: The primary interface with Facebook. It uses Playwright with stealth plugins to navigate dynamic content, handle cookie injection, and extract raw post evidence.
-   **🧠 Reasoner Agent**: The decision-maker. It maintains state and compares new observations with historical data to detect changes and filter out noise.
-   **🔔 Notification Agent**: The outgoing bridge. It transforms detected changes into rich, formatted payloads for Slack notifications.
-   **⏰ Scheduler Agent**: The heartbeat. It enforces operational windows and polling frequencies natively, ensuring the system respects configured business hours.
-   **🧠 State Memory**: The system's memory. It utilizes a persistent storage layer (PostgreSQL) to reliably track previously seen content.
-   **🕹️ Orchestrator**: The conductor. It wires the agents together, manages the execution lifecycle, and ensures the event-driven loop remains robust.

## ✨ Key Capabilities

-   **🛡️ Auth Persistence**: Integrated authentication script (`npm run auth`) to capture and rotate Facebook session cookies, effectively bypassing aggressive login walls.
-   **🐳 Docker Native**: Fully containerized architecture with multi-stage builds and automated CI/CD via Jenkins.

---

## 🚀 Getting Started

### Prerequisites

-   **Node.js**: v20 or later (v18 minimum)
-   **Postgres**: A running instance for state persistence and audit logs.
-   **Slack**: A configured Webhook URL for notifications.

### Installation

1.  **Clone & Install**:
    ```bash
    git clone https://github.com/thanhduy1706/fb-watchtower.git
    cd fb-watchtower
    npm install
    ```

2.  **Environment Setup**:
    Create a `.env` file in the root directory. Use the following template:
    ```env
    # Monitoring Target
    FACEBOOK_PAGE_URL=https://www.facebook.com/TargetPageName

    # Notifications
    SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz

    # Database (Postgres)
    DATABASE_HOST=localhost
    DATABASE_PORT=5432
    DATABASE_USERNAME=postgres
    DATABASE_PASSWORD=your_password
    DATABASE_NAME=watchtower

    # Scheduling (HH:mm)
    SCHEDULE_START=08:00
    SCHEDULE_END=20:00
    TIMEZONE=Asia/Ho_Chi_Minh
    CHECK_INTERVAL_MS=300000
    ```

3.  **Authentication (Crucial)**:
    Facebook often blocks unauthenticated scrapers. Run the following command once to log in and save your session cookies:
    ```bash
    npm run auth
    ```
    *This will open a browser window for you to log in manually. Once logged in, the cookies will be saved to your `.env`.*

---

## 🛠️ Usage

### Development
Run the orchestrator with hot-reloading:
```bash
npm run start
```

### Testing
Run the suite using Vitest:
```bash
npm test
```

### Linting & Formatting
Ensure code quality and consistency:
```bash
npm run lint:fix
npm run format
```

---

## 🐳 Deployment

The project includes a `Dockerfile` and a `Jenkinsfile` for automated deployment.

**Build and run locally with Docker:**
```bash
docker build -t fb-watchtower .
docker run --env-file .env fb-watchtower
```

---

## 📜 License

Private / Proprietary. All rights reserved.

