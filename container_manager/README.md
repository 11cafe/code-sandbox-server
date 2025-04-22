# Express TypeScript Server

A simple Express server built with TypeScript.

## Installation

```bash
npm install
```

## Development

To run the server in development mode with hot-reload:

```bash
npm run dev
```

## Production

To build and run the server in production:

```bash
npm run build
npm start
```

The server will be running on http://localhost:3000

## HTTPS certs setup

```
sudo certbot certonly \
 --manual \
 --preferred-challenges dns \
 -d runbox.ai -d '\*.runbox.ai'
```
