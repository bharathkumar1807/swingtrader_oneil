namespace SwingTrader.API.Models;

// ─── Stock ────────────────────────────────────────────────────
public class Stock
{
    public int Id { get; set; }
    public string Symbol { get; set; } = "";
    public string CompanyName { get; set; } = "";
    public string Sector { get; set; } = "";
    public string Industry { get; set; } = "";
    public decimal? EpsGrowthQoQ { get; set; }        // C in CANSLIM
    public decimal? EpsGrowthAnnual { get; set; }     // A in CANSLIM
    public decimal? RsRating { get; set; }            // L in CANSLIM
    public decimal? Float { get; set; }               // S in CANSLIM
    public decimal? MarketCap { get; set; }
    public decimal? AvgVolume50Day { get; set; }
    public decimal? Week52High { get; set; }
    public decimal? Week52Low { get; set; }
    public DateTime LastFundamentalsUpdate { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// ─── Watchlist ────────────────────────────────────────────────
public class WatchlistItem
{
    public int Id { get; set; }
    public string Symbol { get; set; } = "";
    public string Notes { get; set; } = "";
    public string PatternSeen { get; set; } = "";     // Cup, VCP, etc.
    public int CanslimScore { get; set; }
    public int MinerviniScore { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
}

// ─── TradeSetup ───────────────────────────────────────────────
public class TradeSetup
{
    public int Id { get; set; }
    public string Symbol { get; set; } = "";
    public string Pattern { get; set; } = "";         // CupHandle, VCP, FlatBase etc.
    public decimal EntryPrice { get; set; }
    public decimal StopLoss { get; set; }
    public decimal Target1R { get; set; }
    public decimal Target20Pct { get; set; }
    public decimal Target3R { get; set; }
    public int Shares { get; set; }
    public decimal PositionSize { get; set; }
    public decimal AccountSize { get; set; }
    public decimal RiskPercent { get; set; }
    public int CanslimScore { get; set; }
    public int MinerviniScore { get; set; }
    public string MarketDirection { get; set; } = ""; // Uptrend, Correction etc.
    public string Status { get; set; } = "Planned";  // Planned, Active, Closed
    public string Notes { get; set; } = "";
    public bool IsPaperTrade { get; set; } = true;
    public bool TelegramAlerted { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Position? Position { get; set; }
}

// ─── Position (Active Trade) ──────────────────────────────────
public class Position
{
    public int Id { get; set; }
    public int TradeSetupId { get; set; }
    public string Symbol { get; set; } = "";
    public decimal EntryPrice { get; set; }
    public decimal? FillPrice { get; set; }           // Actual Alpaca fill price
    public int Shares { get; set; }
    public decimal CurrentPrice { get; set; }
    public decimal UnrealizedPnL { get; set; }
    public decimal UnrealizedPnLPct { get; set; }
    public decimal StopLoss { get; set; }
    public int DaysHeld { get; set; }
    public DateTime EntryDate { get; set; }
    public string Status { get; set; } = "Open";     // PendingFill, Open, Closed

    // Alpaca order tracking
    public string? AlpacaOrderId { get; set; }       // Parent buy limit order
    public string? AlpacaStopOrderId { get; set; }   // Stop-loss leg order
    public string AlpacaStatus { get; set; } = "None"; // None, New, PartiallyFilled, Filled, Canceled

    // Navigation
    public TradeSetup TradeSetup { get; set; } = null!;
    public TradeJournal? Journal { get; set; }
}

// ─── TradeJournal (Closed Trade) ─────────────────────────────
public class TradeJournal
{
    public int Id { get; set; }
    public int PositionId { get; set; }
    public string Symbol { get; set; } = "";
    public decimal EntryPrice { get; set; }
    public decimal ExitPrice { get; set; }
    public int Shares { get; set; }
    public decimal RealizedPnL { get; set; }
    public decimal RealizedPnLPct { get; set; }
    public string ExitReason { get; set; } = "";     // StopHit, Rule20Pct, Distribution, Trailing
    public string Grade { get; set; } = "";          // A, B, C
    public string Notes { get; set; } = "";
    public string Pattern { get; set; } = "";
    public string MarketDirection { get; set; } = "";
    public int DaysHeld { get; set; }
    public DateTime EntryDate { get; set; }
    public DateTime ExitDate { get; set; } = DateTime.UtcNow;

    // Navigation
    public Position Position { get; set; } = null!;
}

// ─── ScreenerResult ───────────────────────────────────────────
public class ScreenerResult
{
    public int Id { get; set; }
    public string Symbol { get; set; } = "";
    public int CanslimScore { get; set; }
    public int MinerviniScore { get; set; }
    public decimal RsRating { get; set; }
    public decimal EpsGrowth { get; set; }
    public decimal PriceVs52WeekHigh { get; set; }   // % below 52w high
    public decimal AvgVolumeRatio { get; set; }
    public string Sector { get; set; } = "";
    public DateTime ScanDate { get; set; } = DateTime.UtcNow;
}

// ─── MarketLog ────────────────────────────────────────────────
public class MarketLog
{
    public int Id { get; set; }
    public string Direction { get; set; } = "";      // ConfirmedUptrend, UnderPressure, RallyAttempt, Correction
    public int DistributionDayCount { get; set; }
    public bool IsFollowThroughDay { get; set; }
    public string Notes { get; set; } = "";
    public DateTime LogDate { get; set; } = DateTime.UtcNow;
}

// ─── Bot Subscriber ───────────────────────────────────────────
public class BotSubscriber
{
    public long ChatId { get; set; }           // Telegram chat ID (primary key)
    public string FirstName { get; set; } = "";
    public string Username { get; set; } = "";
    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
}

// ─── Trade Challenge (15-day real-money test) ─────────────────
public class TradeChallenge
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public DateTime StartDate { get; set; }
    public decimal StartingCapital { get; set; }
    public int TargetDays { get; set; } = 15;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<ImportedTrade> Trades { get; set; } = new();
}

// ─── Imported Trade (parsed from Robinhood CSV / PDF) ─────────
public class ImportedTrade
{
    public int Id { get; set; }
    public int? ChallengeId { get; set; }
    public int? TradeSetupId { get; set; }   // linked back to the plan that generated this trade
    public string Symbol { get; set; } = "";
    public DateTime EntryDate { get; set; }
    public DateTime ExitDate { get; set; }
    public decimal EntryPrice { get; set; }
    public decimal ExitPrice { get; set; }
    public decimal Shares { get; set; }
    public decimal PnLDollar { get; set; }
    public decimal PnLPct { get; set; }
    public int HoldDays { get; set; }
    public string Source { get; set; } = "Robinhood";
    public DateTime ImportedAt { get; set; } = DateTime.UtcNow;
    public TradeChallenge? Challenge { get; set; }
    public TradeSetup? Setup { get; set; }
}

// ─── Open Lot (buy from broker with no matching sell yet) ──────
public class OpenLot
{
    public int Id { get; set; }
    public string Symbol { get; set; } = "";
    public DateTime BuyDate { get; set; }
    public decimal BuyPrice { get; set; }
    public decimal Shares { get; set; }
    public string Source { get; set; } = "Robinhood";
    public DateTime ImportedAt { get; set; } = DateTime.UtcNow;
}

// ─── Alert ────────────────────────────────────────────────────
public class Alert
{
    public int Id { get; set; }
    public string Symbol { get; set; } = "";
    public string AlertType { get; set; } = "";      // PriceAbove, PriceBelow, ProfitTarget, StopLoss
    public decimal TriggerPrice { get; set; }
    public bool IsTriggered { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? TriggeredAt { get; set; }
}
