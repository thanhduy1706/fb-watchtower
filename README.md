# fb-watchtower

Facebook Page monitoring system built with a multi-agent architecture.

fb-watchtower consists of distributed agents that autonomously monitor a public Facebook Page and dispatch near-real-time Slack notifications when new posts are detected.

## Architecture

The system utilizes an orchestrator and several specific agents, running in an event-driven loop:
- **Monitoring Agent**: Extracts the latest posts and metadata dynamically using Playwright.
- **Reasoner Agent**: Evaluates observations against previous states to determine if notifications should trigger.
- **Notification Agent**: Formats payloads and sends alerts to Slack channels.
- **Scheduler Agent**: Enforces operational window (e.g., polling during specific hours) natively, keeping execution cycles clean.
- **State Memory**: Persists previous post links reliably, acting as the system's brain to track changes.
- **Orchestrator**: Wires agents together and schedules the cycle loops.

## Features
- **Headless scraping**: Playwright integrates effectively to parse client-rendered posts.
- **Robust resilience**: Includes exponential backoff retries, CSS selectors fallbacks, and overlay dismissals.
- **Timezone-aware scheduler**: Enforce temporal compliance without messy cron jobs.
- **Event Bus Pipeline**: Complete loosely-coupled components scaling with node.js event emitters natively.

## Getting Started

### Prerequisites

- Node.js > v18
- PostgreSQL or other storage implementation
- Slack Webhook URL

### Installation

1. Clone the repository:
```bash
git clone https://github.com/thanhduy1706/fb-watchtower.git
cd fb-watchtower
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Configure your variables. You will need a `.env` file referencing the deployment properties (e.g., Slack URLs, Page URL, schedules).

### Usage

```bash
# Start the system
npm run start
```

### CI/CD Deployment

The repository includes a Jenkins pipeline inside `Jenkinsfile` configuring automated Docker builds and lifecycle restarts for containerized hosting.

## License

Private / Proprietary
