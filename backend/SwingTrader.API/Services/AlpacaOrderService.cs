using Alpaca.Markets;

namespace SwingTrader.API.Services;

public class AlpacaOrderService
{
    private readonly IAlpacaTradingClient _client;
    private readonly ILogger<AlpacaOrderService> _logger;

    public AlpacaOrderService(IConfiguration config, ILogger<AlpacaOrderService> logger)
    {
        _logger = logger;
        var apiKey = config["Alpaca:ApiKey"]!;
        var secretKey = config["Alpaca:SecretKey"]!;
        var isPaper = config.GetValue<bool>("Alpaca:IsPaper");

        var environment = isPaper ? Alpaca.Markets.Environments.Paper : Alpaca.Markets.Environments.Live;
        _client = environment.GetAlpacaTradingClient(new SecretKey(apiKey, secretKey));
    }

    // Places a buy limit order with an attached stop-loss (OTO).
    // The stop leg only activates once the buy fills — no premature trigger risk.
    public async Task<(Guid OrderId, Guid? StopOrderId)> PlaceEntryWithStopAsync(
        string symbol, int qty, decimal limitPrice, decimal stopPrice)
    {
        var order = await _client.PostOrderAsync(
            LimitOrder.Buy(symbol, OrderQuantity.FromInt64(qty), limitPrice)
                .WithDuration(TimeInForce.Day)
                .StopLoss(stopPrice));  // stop leg is GTC by default

        var stopLeg = order.Legs?.Count > 0 ? order.Legs[0] : null;
        _logger.LogInformation(
            "OTO order placed for {Symbol}: buy={OrderId} stop={StopId}",
            symbol, order.OrderId, stopLeg?.OrderId);

        return (order.OrderId, stopLeg?.OrderId);
    }

    // Market sell to exit a position immediately.
    public async Task<Guid> PlaceMarketSellAsync(string symbol, int qty)
    {
        var order = await _client.PostOrderAsync(
            MarketOrder.Sell(symbol, OrderQuantity.FromInt64(qty))
                .WithDuration(TimeInForce.Day));

        _logger.LogInformation("Market sell placed for {Symbol}: {OrderId}", symbol, order.OrderId);
        return order.OrderId;
    }

    // Cancel any open order (used to cancel the stop-loss before a manual exit).
    public async Task<bool> CancelOrderAsync(Guid orderId)
    {
        try
        {
            await _client.CancelOrderAsync(orderId);
            _logger.LogInformation("Cancelled order {OrderId}", orderId);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Cancel failed for {OrderId} (may already be filled/cancelled)", orderId);
            return false;
        }
    }

    // Fetch a single order's current status from Alpaca.
    public async Task<IOrder> GetOrderAsync(Guid orderId) =>
        await _client.GetOrderAsync(orderId);

    // List all open orders across all symbols.
    public async Task<IReadOnlyList<IOrder>> GetOpenOrdersAsync() =>
        await _client.ListOrdersAsync(
            new ListOrdersRequest { OrderStatusFilter = OrderStatusFilter.Open });

    // List current positions held in the Alpaca (paper) account.
    public async Task<IReadOnlyList<IPosition>> GetAlpacaPositionsAsync() =>
        await _client.ListPositionsAsync();

    // Fetch the Alpaca account summary (buying power, equity, etc.)
    public async Task<IAccount> GetAccountAsync() =>
        await _client.GetAccountAsync();
}
