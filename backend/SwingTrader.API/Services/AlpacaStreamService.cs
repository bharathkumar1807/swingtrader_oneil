using Alpaca.Markets;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using SwingTrader.API.Data;
using SwingTrader.API.Hubs;

namespace SwingTrader.API.Services;

public class AlpacaStreamService : IHostedService, IDisposable
{
    private readonly IConfiguration _config;
    private readonly IHubContext<PriceHub> _hub;
    private readonly ILogger<AlpacaStreamService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly TelegramService _telegram;
    private IAlpacaDataStreamingClient? _streamingClient;
    private readonly HashSet<string> _subscribedSymbols = new();

    public AlpacaStreamService(
        IConfiguration config,
        IHubContext<PriceHub> hub,
        IServiceScopeFactory scopeFactory,
        TelegramService telegram,
        ILogger<AlpacaStreamService> logger)
    {
        _config = config;
        _hub = hub;
        _scopeFactory = scopeFactory;
        _telegram = telegram;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var apiKey = _config["Alpaca:ApiKey"]!;
        var secretKey = _config["Alpaca:SecretKey"]!;
        var isPaper = _config.GetValue<bool>("Alpaca:IsPaper");

        var environment = isPaper ? Alpaca.Markets.Environments.Paper : Alpaca.Markets.Environments.Live;
        var credentials = new SecretKey(apiKey, secretKey);

        _streamingClient = environment.GetAlpacaDataStreamingClient(credentials);

        _streamingClient.Connected += async (status) =>
        {
            _logger.LogInformation("Alpaca stream connected: {Status}", status);
            await SubscribePlannedSymbolsAsync(cancellationToken);
        };

        await _streamingClient.ConnectAndAuthenticateAsync(cancellationToken);
        _logger.LogInformation("Alpaca WebSocket stream started");
    }

    // On connect, auto-subscribe all currently planned symbols
    private async Task SubscribePlannedSymbolsAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var symbols = await db.TradeSetups
            .Where(t => t.Status == "Planned" && !t.TelegramAlerted)
            .Select(t => t.Symbol)
            .Distinct()
            .ToListAsync(ct);

        foreach (var symbol in symbols)
            await SubscribeToSymbol(symbol);
    }

    // Call this when user adds a symbol to watchlist/positions
    public async Task SubscribeToSymbol(string symbol)
    {
        if (_streamingClient == null || _subscribedSymbols.Contains(symbol)) return;

        var subscription = _streamingClient.GetMinuteBarSubscription(symbol);
        subscription.Received += async (bar) =>
        {
            var update = new PriceUpdate
            {
                Symbol = bar.Symbol,
                Price = bar.Close,
                Volume = (long)bar.Volume,
                Timestamp = bar.TimeUtc
            };

            // Push to React frontend
            await _hub.Clients.Group($"price-{symbol}")
                .SendAsync("PriceUpdate", update);

            // Check breakout against any planned setup for this symbol
            await CheckBreakoutAsync(bar.Symbol, bar.Close, (long)bar.Volume);
        };

        await _streamingClient.SubscribeAsync(subscription);
        _subscribedSymbols.Add(symbol);
        _logger.LogInformation("Subscribed to {Symbol}", symbol);
    }

    private async Task CheckBreakoutAsync(string symbol, decimal price, long volume)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var plans = await db.TradeSetups
            .Where(t => t.Symbol == symbol && t.Status == "Planned" && !t.TelegramAlerted)
            .ToListAsync();

        foreach (var plan in plans)
        {
            if (price < plan.EntryPrice) continue;

            var riskPct  = plan.EntryPrice > 0 ? (plan.EntryPrice - plan.StopLoss) / plan.EntryPrice * 100 : 0;
            var chasePct = Math.Round((price - plan.EntryPrice) / plan.EntryPrice * 100, 1);
            var chaseWarning = chasePct > 3 ? $"\n⚠️ <b>Chasing +{chasePct}% above entry</b>" : "";

            var message = $"""
                🚀 <b>BREAKOUT — {plan.Symbol}</b>{(string.IsNullOrWhiteSpace(plan.Pattern) ? "" : $"\nPattern: {System.Net.WebUtility.HtmlEncode(plan.Pattern)}")}

                💰 <b>Buy:</b> <code>${plan.EntryPrice:F2}</code>
                🛑 <b>Stop Loss:</b> <code>${plan.StopLoss:F2}</code> ({riskPct:F1}% risk)
                🎯 <b>Target +20%:</b> <code>${plan.Target20Pct:F2}</code>
                📊 <b>Target 1R:</b> <code>${plan.Target1R:F2}</code>
                📈 <b>Target 3R:</b> <code>${plan.Target3R:F2}</code>

                Current: <code>${price:F2}</code>{chaseWarning}
                Minervini: {plan.MinerviniScore}/7
                """;

            await _telegram.SendMessageAsync(message);
            plan.TelegramAlerted = true;
            _logger.LogInformation("Stream breakout alert sent for {Symbol} @ ${Price:F2}", symbol, price);
        }

        await db.SaveChangesAsync();
    }

    public async Task UnsubscribeFromSymbol(string symbol)
    {
        if (_streamingClient == null || !_subscribedSymbols.Contains(symbol)) return;

        var subscription = _streamingClient.GetMinuteBarSubscription(symbol);
        await _streamingClient.UnsubscribeAsync(subscription);
        _subscribedSymbols.Remove(symbol);
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_streamingClient != null)
            await _streamingClient.DisconnectAsync(cancellationToken);
    }

    public void Dispose() => _streamingClient?.Dispose();
}
