# College Auditorium Coordination System

## 1. Overview

The College Auditorium Coordination System is a web application designed to simplify auditorium booking and coordination within a college. It provides a centralized platform for managing booking requests, checking availability, and coordinating auditorium usage through role-based access.

## 2. Problem Statement

Manual auditorium booking can lead to scheduling conflicts, communication gaps, and difficulty tracking requests. This system aims to make the booking process more organized, transparent, and efficient.

## 3. Key Features

- Role-based access for Students, Faculty, and Principal.
- Auditorium booking and availability management.
- Booking conflict checks.
- SQLite database for persistent storage.
- Principal account setup protected by a setup key.

## 4. Technology Stack

- **Backend:** Node.js and JavaScript
- **Database:** SQLite
- **Frontend:** Web interface
- **Package Manager:** npm

## 5. Prerequisites

Install Node.js (LTS) and Git before proceeding.

Verify the installations:

```bash
node --version
npm --version
git --version
```

## 6. Setup and Installation

Clone the repository:

```bash
git clone https://github.com/S2004-21/college-auditorium-coordination.git
cd college-auditorium-coordination
npm install
```

If the repository contains nested project folders, navigate into the directory containing `package.json`.

Install dependencies:

```bash
npm install
```

Create your local environment configuration from the example file:

```powershell
Copy-Item .env.example .env
```

Configure the values in `.env` according to the application's supported environment variables:

```env
PORT=3000
SETUP_KEY=your-private-setup-key
DB_PATH=./data/auditorium.db
```

Generate a secure setup key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use the generated key in `.env`. Never commit your actual `.env` file or expose the setup key publicly.

## 7. Run and Test

Start the application:

```bash
npm start
```

Open `http://localhost:3000` in your browser.

Run automated tests, if configured:

```bash
npm test
```

The available commands depend on the scripts defined in `package.json`.

### 8. Principal Setup

The application supports a one-time initial setup to create the first Principal account. Follow these steps when running the application for the first time.

## Step 1: Configure the Environment

Copy the example environment file to create your local `.env` file. Run this command in PowerShell from the project directory:

```powershell
Copy-Item .env.example .env
```

## Step 2: Generate a Secure Setup Key

Generate a random setup key using Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the generated value into your `.env` file as the value of `SETUP_KEY`:

```env
PORT=3000
SETUP_KEY=your-generated-private-setup-key
```

Replace the placeholder with the generated key. Keep the `.env` file private and never commit it to GitHub.

## Step 3: Start the Application

Run the application:

```bash
npm start
```

Open the following URL in your browser:

`http://localhost:3000`

## Step 4: Create the Principal Account

On the first launch, when no Principal account exists, the application displays the initial setup form. Enter:

- **Initial setup key:** The value configured as `SETUP_KEY` in `.env`.
- **Principal display name:** The name to display in the application.
- **Principal username:** A unique username.
- **Password:** A password containing at least 10 characters.

Submit the form to create the Principal account. After successful setup, the application signs the Principal in automatically.

## Step 5: Log In on Future Visits

Once the Principal account has been created, the initial setup process cannot be repeated. Use the Principal username and password created during setup to log in on future visits. The setup key is only required for the initial account creation.

The Principal can then create Student and Faculty accounts, manage users, review booking requests, and manage official auditorium bookings.

**Important:** The `.env` file contains private configuration and must not be committed to Git. The `data/` directory contains local database files and is also excluded from Git through `.gitignore`.

## 9. How It Works

Users interact with the web interface, and the Node.js backend processes booking requests and applies the relevant validation rules. SQLite stores application data, while the principal setup mechanism protects the initial administrative account setup.

## 10. Assumptions

- The application is intended for college auditorium coordination.
- Different user roles have different permissions.
- SQLite is used for local data persistence.
- Environment-specific configuration and secrets are maintained locally.
- Available functionality depends on the implemented application features.
