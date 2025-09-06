# DEX-CEX Arbitrage Monitoring App

This application monitors DEX-CEX arbitrage opportunities by polling data from specified endpoints, storing it, and providing a web interface to visualize the data.

## Running the Application

### With Docker (Recommended)

1.  **Build and run the container:**
    ```bash
    docker-compose up -d --build
    ```
2.  The application will be available at `http://localhost:8080`.

### Without Docker

1.  **Backend:**
    ```bash
    cd backend
    npm install
    npm run dev
    ```
2.  **Frontend:**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```
