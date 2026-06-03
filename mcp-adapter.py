"""
x402-Crypto-API MCP Adapter (Python Version)

使用 FastMCP 框架创建的 MCP 适配器
安装: pip install mcp httpx
运行: python mcp-adapter.py
"""

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("x402-crypto-api")

X402_API_BASE = "https://spectacular-strength-production-0494.up.railway.app"


@mcp.tool()
async def btc_price(currency: str = "USD") -> str:
    """Get current Bitcoin (BTC) price in USD or specified currency.
    
    Args:
        currency: Target currency code (default: USD, supports: USD, EUR, GBP, etc.)
    
    Returns:
        JSON string with BTC price data
    """
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{X402_API_BASE}/api/crypto/btc/price",
            params={"currency": currency}
        )
        return response.text


@mcp.tool()
async def eth_price(currency: str = "USD") -> str:
    """Get current Ethereum (ETH) price in USD or specified currency.
    
    Args:
        currency: Target currency code (default: USD, supports: USD, EUR, GBP, etc.)
    
    Returns:
        JSON string with ETH price data
    """
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{X402_API_BASE}/api/crypto/eth/price",
            params={"currency": currency}
        )
        return response.text


@mcp.tool()
async def market_data(limit: int = 10) -> str:
    """Get cryptocurrency market data including top coins by market cap.
    
    Args:
        limit: Number of coins to return (default: 10, max: 100)
    
    Returns:
        JSON string with market data for top cryptocurrencies
    """
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{X402_API_BASE}/api/crypto/market",
            params={"limit": min(limit, 100)}
        )
        return response.text


@mcp.tool()
async def trending_coins(limit: int = 10) -> str:
    """Get trending cryptocurrency coins.
    
    Args:
        limit: Number of trending coins to return (default: 10)
    
    Returns:
        JSON string with trending coins data
    """
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{X402_API_BASE}/api/crypto/trending",
            params={"limit": limit}
        )
        return response.text


@mcp.tool()
async def api_status() -> str:
    """Check the x402 API service status and payment requirements.
    
    Returns:
        JSON string with API status and x402 payment info
    """
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{X402_API_BASE}/status")
        return response.text


@mcp.tool()
async def coin_price(symbol: str, currency: str = "USD") -> str:
    """Get price for any supported cryptocurrency.
    
    Args:
        symbol: Coin symbol (e.g., BTC, ETH, SOL, DOGE)
        currency: Target currency code (default: USD)
    
    Returns:
        JSON string with price data for the specified coin
    """
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{X402_API_BASE}/api/crypto/price",
            params={
                "symbol": symbol.upper(),
                "currency": currency
            }
        )
        return response.text


@mcp.tool()
async def health_check() -> str:
    """Check if the x402 API service is healthy and operational.
    
    Returns:
        JSON string with health status
    """
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{X402_API_BASE}/health")
        return response.text


if __name__ == "__main__":
    # Run with SSE transport for web deployment
    mcp.run(transport="sse")
