using Microsoft.EntityFrameworkCore;
using SwingTrader.API.Data;
using SwingTrader.API.Models;

namespace SwingTrader.API.Services;

public class TradeService
{
    private readonly AppDbContext _db;
    private readonly AlpacaOrderService _orders;

    public TradeService(AppDbContext db, AlpacaOrderService orders)
    {
        _db = db;
        _orders = orders;
    }

    public async Task<TradeSetup> CreateSetupAsync(CreateTradeSetupDto dto)
    {
        var risk = dto.EntryPrice - dto.StopLoss;
        var setup = new TradeSetup
        {
            Symbol = dto.Symbol.ToUpper(),
            Pattern = dto.Pattern,
            EntryPrice = dto.EntryPrice,
            StopLoss = dto.StopLoss,
            Target1R = dto.EntryPrice + risk,
            Target20Pct = dto.EntryPrice * 1.20m,
            Target3R = dto.EntryPrice + (risk * 3),
            Shares = dto.Shares,
            PositionSize = dto.EntryPrice * dto.Shares,
            AccountSize = dto.AccountSize,
            RiskPercent = dto.RiskPercent,
            CanslimScore = dto.CanslimScore,
            MinerviniScore = dto.MinerviniScore,
            MarketDirection = dto.MarketDirection,
            Notes = dto.Notes,
            IsPaperTrade = dto.IsPaperTrade
        };

        _db.TradeSetups.Add(setup);
        await _db.SaveChangesAsync();
        return setup;
    }

    // Places a buy limit + attached stop-loss (OTO) via Alpaca, then records the
    // position as PendingFill. Call /api/orders/sync/{positionId} to confirm the fill.
    public async Task<Position> ActivateTradeAsync(int setupId)
    {
        var setup = await _db.TradeSetups.FindAsync(setupId)
            ?? throw new Exception("Setup not found");

        var (orderId, stopOrderId) = await _orders.PlaceEntryWithStopAsync(
            setup.Symbol,
            setup.Shares,
            setup.EntryPrice,
            setup.StopLoss);

        setup.Status = "Active";

        var position = new Position
        {
            TradeSetupId = setupId,
            Symbol = setup.Symbol,
            EntryPrice = setup.EntryPrice,
            Shares = setup.Shares,
            CurrentPrice = setup.EntryPrice,
            StopLoss = setup.StopLoss,
            EntryDate = DateTime.UtcNow,
            Status = "PendingFill",
            AlpacaOrderId = orderId.ToString(),
            AlpacaStopOrderId = stopOrderId?.ToString(),
            AlpacaStatus = "New"
        };

        _db.Positions.Add(position);
        await _db.SaveChangesAsync();
        return position;
    }

    // Cancels the open stop-loss order, then places a market sell to exit immediately.
    public async Task<TradeJournal> CloseTradeAsync(CloseTradeDto dto)
    {
        var position = await _db.Positions
            .Include(p => p.TradeSetup)
            .FirstOrDefaultAsync(p => p.Id == dto.PositionId)
            ?? throw new Exception("Position not found");

        // Cancel the stop-loss leg so it doesn't race with our market sell
        if (!string.IsNullOrEmpty(position.AlpacaStopOrderId) &&
            Guid.TryParse(position.AlpacaStopOrderId, out var stopGuid))
        {
            await _orders.CancelOrderAsync(stopGuid);
        }

        // Place market sell — fill price recorded after sync or approximated now
        await _orders.PlaceMarketSellAsync(position.Symbol, position.Shares);

        var exitPrice = dto.ExitPrice;
        var pnl = (exitPrice - position.EntryPrice) * position.Shares;
        var pnlPct = (exitPrice - position.EntryPrice) / position.EntryPrice * 100;

        position.Status = "Closed";
        position.AlpacaStatus = "Closed";
        position.TradeSetup.Status = "Closed";

        var journal = new TradeJournal
        {
            PositionId = position.Id,
            Symbol = position.Symbol,
            EntryPrice = position.FillPrice ?? position.EntryPrice,
            ExitPrice = exitPrice,
            Shares = position.Shares,
            RealizedPnL = pnl,
            RealizedPnLPct = pnlPct,
            ExitReason = dto.ExitReason,
            Grade = dto.Grade,
            Notes = dto.Notes,
            Pattern = position.TradeSetup.Pattern,
            MarketDirection = position.TradeSetup.MarketDirection,
            DaysHeld = (DateTime.UtcNow - position.EntryDate).Days,
            EntryDate = position.EntryDate
        };

        _db.TradeJournal.Add(journal);
        await _db.SaveChangesAsync();
        return journal;
    }

    public PositionSizeResult CalculatePositionSize(decimal accountSize, decimal riskPct,
        decimal entryPrice, decimal stopLoss)
    {
        var dollarRisk = accountSize * (riskPct / 100);
        var riskPerShare = entryPrice - stopLoss;
        var shares = riskPerShare > 0 ? (int)(dollarRisk / riskPerShare) : 0;

        return new PositionSizeResult
        {
            EntryPrice = entryPrice,
            StopLoss = stopLoss,
            RiskPerShare = riskPerShare,
            DollarRisk = dollarRisk,
            Shares = shares,
            PositionSize = shares * entryPrice,
            Target1R = entryPrice + riskPerShare,
            Target20Pct = entryPrice * 1.20m,
            Target3R = entryPrice + (riskPerShare * 3),
            StopLossPct = riskPerShare / entryPrice * 100
        };
    }
}

// ─── DTOs ─────────────────────────────────────────────────────
public class CreateTradeSetupDto
{
    public string Symbol { get; set; } = "";
    public string Pattern { get; set; } = "";
    public decimal EntryPrice { get; set; }
    public decimal StopLoss { get; set; }
    public int Shares { get; set; }
    public decimal AccountSize { get; set; }
    public decimal RiskPercent { get; set; }
    public int CanslimScore { get; set; }
    public int MinerviniScore { get; set; }
    public string MarketDirection { get; set; } = "";
    public string Notes { get; set; } = "";
    public bool IsPaperTrade { get; set; } = true;
}

public class CloseTradeDto
{
    public int PositionId { get; set; }
    public decimal ExitPrice { get; set; }
    public string ExitReason { get; set; } = "";
    public string Grade { get; set; } = "";
    public string Notes { get; set; } = "";
}

public class PositionSizeResult
{
    public decimal EntryPrice { get; set; }
    public decimal StopLoss { get; set; }
    public decimal RiskPerShare { get; set; }
    public decimal DollarRisk { get; set; }
    public int Shares { get; set; }
    public decimal PositionSize { get; set; }
    public decimal Target1R { get; set; }
    public decimal Target20Pct { get; set; }
    public decimal Target3R { get; set; }
    public decimal StopLossPct { get; set; }
}
