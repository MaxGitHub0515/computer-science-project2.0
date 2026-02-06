
# 🤖 Among Bots: The AI Social Deduction Game

> **"Spot the Machine before it fools the Man."**
<!-- change the version to 1.0.0 when app is stable -->
<!-- MAIN -->
![Version](https://img.shields.io/badge/version-0.1.0%20-blue)
![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?logo=docker&logoColor=white)
![Deployment](https://img.shields.io/badge/Hosting-DigitalOcean%20-0080FF?logo=digitalocean)
<!--  -->
### **Tools and Frameworks & Core Tech**
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB) ![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white) ![Express](https://img.shields.io/badge/Express-000000?style=flat&logo=express&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white) ![Webpack](https://img.shields.io/badge/Webpack-8DD6F9?style=flat&logo=webpack&logoColor=black) ![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=flat&logo=socketdotio&logoColor=white) ![Zustand](https://img.shields.io/badge/Zustand-443E38?style=flat&logo=react&logoColor=white) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white) 
![ML](https://img.shields.io/badge/AI-Adversarial%20RLHF-8A2BE2)


## 📖 Overview

**Among Bots** is a multiplayer social deduction game powered by Machine Learning. In each lobby, human players are mixed with AI agents. The goal is simple yet technically complex:

1.  **For Humans:** Analyze the chat, spot the anomalies, and vote to eliminate the AI "Imposter."
2.  **For the AI:** Mimic human speech patterns, slang, and reasoning to survive detection.

The project serves a dual purpose: it is an entertaining game for users and a sophisticated **Adversarial Training Ground** for our models.

---

## 🏗 Tech Stack & Architecture

The application is built using a modern TypeScript stack, separated into a Frontend Client and a Backend API.

### **Frontend (Client)**
* **Framework:** React (Custom Webpack Configuration)
* **Language:** TypeScript
* **Hosting:** [DigitalOcean](https://www.digitalocean.com)
* **Styling:** Tailwind CSS / Styled Components
* **State:** React Context API & Hooks

### **Backend (Server)**
* **Runtime:** Node.js
* **Framework:** Express.js
* **Real-time:** Socket.io (for game lobbies and chat)

### **Machine Learning**
* **Objective:** Turing Test compliance.
* **Method:** Reinforcement Learning from Human Feedback (RLHF) based on game outcomes.



[Image of client server architecture diagram]


---

## 🧠 The Core Challenge: Model Training

The central technical "issue" and goal of this project is **undetectability**.

We are training the model to such an extent that the user is highly unlikely to recognize which participant is the bot. We achieve this through:
1.  **Adversarial Gameplay:** Every time a human correctly spots the bot, the model receives a penalty signal.
2.  **Survival Rewards:** If the bot survives a round (or a human is voted out instead), the model is rewarded.
3.  **Data Loop:** Game logs are analyzed to improve the bot's ability to use context, humor, and "imperfect" language (typos, slang) to blend in.



[Image of neural network diagram]


---

## 🎮 Gameplay Features

### The Game Loop
* **Lobby:** 4-6 Participants join.
* **Topic Assignment:** A conversational prompt is given.
* **Chat Round:** Users discuss. The AI generates responses in real-time.
* **Voting Phase:** Users vote on who they think the AI is.
* **Elimination:** The loser is revealed. If the AI survives, it learns.

### 💎 Premium Benefits
Users who subscribe to the Premium version of Among Bots support the server costs and gain access to:
* **Blog Access:** Exclusive ability to **post comments and interact** on the official Among Bots development blog.
* **Advanced Analytics:** See your "Bot Spotting" accuracy stats.
* **Cosmetics:** Unique avatar borders and chat bubble styles.

---
## Architecture
![AmongBots Architecture](./.github/assets/images/prod-web-scheme-arch.png)

## 🚀 Local Development Setup

The project uses **Docker Compose** to orchestrate the frontend and backend services in a unified local network. This ensures real-time communication parity between development and production.

### **1. Prerequisites**
* **Docker & Docker Compose** installed.
* **Node.js Alpine (v18+)** for local script execution outside of containers.

### **2. Orchestration with Docker**
Launch the entire ecosystem with a single command:

```bash
# Build and start all services
docker-compose up --build
# Stop all running containers
docker-compose down
# Run in detached mode
docker-compose up -d
# Check the logs
docker-compose logs
# Check the logs for specific service e.g backend, nginx
docker-compose logs -f <service>
# Open a shell inside a running container
docker-compose exec <service> sh
# Runs a one-time command in a new container
docker-compose run --rm <service> sh
# List running containers
docker ps
