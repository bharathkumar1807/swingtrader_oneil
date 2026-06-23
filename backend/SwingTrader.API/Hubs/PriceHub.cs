using Microsoft.AspNetCore.SignalR;

namespace SwingTrader.API.Hubs;

public class PriceHub : Hub
{
    // Called when React client connects
    public override async Task OnConnectedAsync()
    {
        Console.WriteLine($"Client connected: {Context.ConnectionId}");
        await base.OnConnectedAsync();
    }

    // React client calls this to subscribe to specific symbols
    public async Task SubscribeToSymbols(List<string> symbols)
    {
        foreach (var symbol in symbols)
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, $"price-{symbol}");
        }
        await Clients.Caller.SendAsync("Subscribed", symbols);
    }

    // React client calls this to unsubscribe
    public async Task UnsubscribeFromSymbol(string symbol)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"price-{symbol}");
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        Console.WriteLine($"Client disconnected: {Context.ConnectionId}");
        await base.OnDisconnectedAsync(exception);
    }
}

// ─── Price Update DTO pushed to React ─────────────────────────
public class PriceUpdate
{
    public string Symbol { get; set; } = "";
    public decimal Price { get; set; }
    public decimal Change { get; set; }
    public decimal ChangePct { get; set; }
    public long Volume { get; set; }
    public DateTime Timestamp { get; set; }
}
