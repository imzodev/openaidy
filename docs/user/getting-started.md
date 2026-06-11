# Getting Started

Welcome to Hermes Agent. This guide walks you through setting up and using your AI assistant.

## Prerequisites

Before starting, ensure you have:

- A configured Hermes Agent installation
- Access to at least one messaging channel (e.g., WhatsApp, Telegram)
- Valid credentials for your chosen platforms

## Installation

1. Clone or download the Hermes Agent repository
2. Copy `config.example.yaml` to `config.yaml`
3. Configure your messaging channels (see [Channels](channels.md))
4. Install dependencies: `uv sync` or `pip install -e .`
5. Start the gateway: `hermes run`

## Configuration

Edit `config.yaml` to set up your environment:

```yaml
channels:
  whatsapp:
    enabled: true
    phone_number: your_number
    # Add your WhatsApp credentials

profiles:
  default:
    model: your-model
    personality: helpful
```

## Using Hermes

Once running, interact with Hermes through any connected channel:

1. Send a message to your Hermes number
2. Hermes responds based on your profile and active skills
3. Use commands to control behavior (see below)

## Commands

| Command   | Description                  |
| --------- | ---------------------------- |
| `/help`   | Show available commands      |
| `/skills` | List active skills           |
| `/reset`  | Reset conversation context   |
| `/status` | Show current session status  |
| `/pause`  | Suspend the conversation     |
| `/resume` | Resume a paused conversation |

## Sessions

Hermes maintains conversation sessions that track context, tokens, and state. Each session has a unique key and persists until reset or expired. See [Sessions](sessions.md) for details.

## Profiles

You can maintain multiple profiles for different use cases:

- **Default**: Standard behavior
- **Custom**: Define your own personalities and settings

Switch profiles using the `/profile` command or through configuration.

## Next Steps

- Read [Channels](channels.md) to connect more platforms
- Explore [Skills](../skills/) to extend capabilities
- Review [Memory](memory.md) to understand context handling
