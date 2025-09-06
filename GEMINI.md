### Project Overview

This is a full-stack monorepo application designed for monitoring cryptocurrency arbitrage opportunities between DEX and CEX platforms. It consists of a Node.js/TypeScript backend and a React/TypeScript frontend.

**Backend:**

- **Framework:** Express.js
- **Database:** SQLite with Prisma as the ORM.
- **Core Logic:** A cron job (`node-cron`) runs every two minutes to poll two external HTTP endpoints for balance and trade data.
- **Data Handling:** Fetched JSON data is validated using Zod, then stored in the SQLite database. The database schema includes tables for `balance_timeseries`, `portfolio_timeseries`, and `trades`.
- **API:** Exposes a REST API for the frontend to consume, providing data for snapshots, time-series charts, and trade analytics. It also includes endpoints for exporting data to CSV and Parquet formats.
- **Serving:** The Express server is also configured to serve the built frontend static files.

**Frontend:**

- **Framework:** React with Vite and TypeScript.
- **UI:** A simple dashboard interface with routing provided by `react-router-dom`.
- **Visualization:** Uses `chart.js` and `react-chartjs-2` to display portfolio value over time.
- **Data Fetching:** A custom hook `useData` fetches data from the backend API every 30 seconds.

**Containerization:**

- A multi-stage `Dockerfile` builds both the frontend and backend, creating a single production-ready Node.js image.
- `docker-compose.yml` orchestrates the application, mounting a volume for the SQLite database to ensure data persistence.

### Building and Running

**With Docker (Recommended):**

1.  Ensure you have a `.env` file in the root directory (you can copy `.env.example`).
2.  Run the following command to build and start the container in detached mode:
    ```bash
    docker-compose up -d --build
    ```
3.  The application will be available at `http://localhost:8080` (or the port specified in your `.env` file).

**Without Docker:**

1.  **Backend:**
    ```bash
    cd backend
    npm install
    # For development with auto-reloading
    npm run dev
    # For production
    npm run build
    npm start
    ```
2.  **Frontend:**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```

### Deploying to a Linux (Ubuntu) VM

Since the application is fully containerized with Docker, porting it to a Linux VM is straightforward.

**1. Prepare the VM:**

- **Install Git, Docker, and Docker Compose:** Connect to your Ubuntu VM and run the following commands:
  ```bash
  # Update package lists
  sudo apt update

  # Install Git
  sudo apt install git -y

  # Install Docker Engine
  sudo apt install docker.io -y

  # Install Docker Compose
  sudo apt install docker-compose -y

  # Add your user to the docker group to run docker without sudo (optional)
  sudo usermod -aG docker ${USER}
  # You will need to log out and log back in for this to take effect.
  ```

**2. Deploy the Application:**

- **Clone the repository:**
  ```bash
  git clone <your-repository-url>
  cd DexArbitrageApp
  ```

- **Configure the environment:** Create a `.env` file from the example. The default values are likely fine for a server environment, but you may need to adjust `CORS_ORIGINS` if your frontend is served from a different domain.
  ```bash
  cp .env.example .env
  ```

- **Build and run with Docker Compose:**
  ```bash
  docker-compose up -d --build
  ```

**3. Verify and Access:**

- **Check running containers:**
  ```bash
  docker ps
  ```
  You should see the `dexarbitrageapp_app` container running.

- **View logs:**
  ```bash
  docker-compose logs -f
  ```

- **Access the application:** The application will be accessible at `http://<your-vm-ip-address>:8080` (or the port you specified in `.env`).

- **Firewall Configuration:** If you have a firewall like `ufw` enabled, you'll need to allow traffic on the application's port:
  ```bash
  sudo ufw allow 8080/tcp
  ```

### Development Conventions

- **Monorepo Structure:** Code is separated into `backend` and `frontend` directories.
- **TypeScript:** Both the backend and frontend are written in TypeScript, enforcing type safety.
- **Database Management:** Prisma is used for database schema definition, migrations, and as the query client. Migrations are managed via the `prisma migrate` commands.
- **API-Driven Frontend:** The frontend is decoupled from the backend and interacts with it solely through the defined REST API.
- **Environment Configuration:** Application configuration is managed through environment variables, with an `.env.example` file provided as a template.
- **Linting:** The frontend includes a basic ESLint setup. The backend does not have an explicit linting step in its `package.json` scripts, but one could be added.
- **Testing:** The backend `package.json` includes a `test` script using Jest, but no test files have been implemented yet. This is a TODO for improving project stability.
