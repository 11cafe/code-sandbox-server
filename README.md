# Linux Sandbox MCP Server

A MCP server that enables LLM to control and command a linux sandbox computer, using Docker for container management and Nginx for proxy to let end user to visit the started web service inside sandbox to test website demos AI may write. I can manipulate the linux sandbox to do:
- execute commands in terminal
- view terminal stdio
- write/read files
- use browser and view screenshot [upcoming!]

You can view its workspace files in a code editor conveniently too! 

<img width="572" alt="Screenshot 2025-04-24 at 10 02 52 PM" src="https://github.com/user-attachments/assets/4b6e67df-60bd-44f2-8962-d7113bdd1c39" />

## Examples
## Python website data crawling and analysis
demo video: https://youtu.be/-TrXCXh-eN8

In this example, I asked AI to "caculate the average and media numbers of top 10 largest country in this csv url: https://raw.githubusercontent.com/plotly/datasets/refs/heads/master/2014_world_gdp_with_codes.csv "

It automatically did:
- Downloaded the csv url to sandbox
- Install pandas pip package
- Write python script to caculate numbers
- Write into report

## Website development and deploy to domain URL

demo video: https://youtu.be/ONvT516jLBo

In this example, I asked AI to "Create a create a homepage for a cloud service software company with two pages: home page and contact us page, and deploy it as a public URL"

It created 2 html files, and hosted it as a static website and gave me the URL to view it.

## Install
Install MCP client:

The MCP client repo is at: https://github.com/11cafe/website-publisher-mcp

```
{
  "mcpServers": {
    "runbox-website-publisher": {
      "command": "npx",
      "args": ["-y", "code-sandbox-mcp@latest"]
    }
  }
}

```

Install server:

`./install.sh`

## Start

`./start.sh`

## Reload Nginx Config

`sudo nginx -s reload`
