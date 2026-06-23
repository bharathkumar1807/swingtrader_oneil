using SwingTrader.API.Services;
using Alpaca.Markets;

namespace SwingTrader.API.Services;

public class BacktestService
{
    private readonly AlpacaDataService _alpaca;
    private readonly ILogger<BacktestService> _logger;

    public BacktestService(AlpacaDataService alpaca, ILogger<BacktestService> logger)
    {
        _alpaca = alpaca;
        _logger = logger;
    }

    public async Task<BacktestResult> RunAsync(BacktestRequest req)
    {
        // Fetch up to 1000 daily bars (~4 years). Bars are ordered oldest → newest.
        var allBars = await _alpaca.GetBarsAsync(req.Symbol, BarTimeFrame.Day, 1000);

        if (allBars.Count < 250)
            throw new Exception($"Not enough historical data for {req.Symbol}. Need at least 250 bars.");

        var result = new BacktestResult
        {
            Symbol    = req.Symbol.ToUpper(),
            StartDate = req.StartDate,
            EndDate   = req.EndDate,
        };

        var trades       = new List<BacktestTrade>();
        decimal equity   = req.AccountSize;
        decimal peak     = equity;
        decimal maxDD    = 0;
        var equityCurve  = new List<EquityPoint>
        {
            new() { Date = allBars[0].Time.ToString("yyyy-MM-dd"), Equity = equity }
        };

        bool    inPosition    = false;
        decimal entryPrice    = 0;
        decimal stopPrice     = 0;
        decimal targetPrice   = 0;
        int     entryBarIdx   = 0;
        int     cooldown      = 0;

        for (int i = 200; i < allBars.Count; i++)
        {
            var today   = allBars[i];
            bool inRange = today.Time.Date >= req.StartDate.Date &&
                           today.Time.Date <= req.EndDate.Date;

            // ── SCANNING FOR ENTRY ──────────────────────────────
            if (!inPosition)
            {
                if (cooldown > 0) { cooldown--; continue; }
                if (!inRange) continue;

                // Minervini score from all closes up to yesterday (no look-ahead)
                var closes = allBars.Take(i).Select(b => b.Close).ToList();
                if (MinerviniScore(closes) < 5) continue;

                // Pivot high = highest high of the 50 bars ending yesterday
                int    lookbackStart = Math.Max(0, i - 50);
                decimal pivot50High  = allBars.Skip(lookbackStart).Take(i - lookbackStart)
                                              .Max(b => b.High);

                // Volume confirmation: today > 1.3× 50-day average
                decimal avg50Vol = allBars.Skip(lookbackStart).Take(i - lookbackStart)
                                          .Average(b => (decimal)b.Volume);
                bool volumeOk = (decimal)today.Volume > avg50Vol * 1.3m;

                // Breakout: today closes above yesterday's 50-day pivot high
                if (today.Close <= pivot50High || !volumeOk) continue;

                // Stop = lowest low of last 20 bars before today
                int    stopStart = Math.Max(0, i - 20);
                decimal stop     = allBars.Skip(stopStart).Take(i - stopStart)
                                          .Min(b => b.Low);

                // Skip degenerate setups (stop too tight or above entry)
                decimal rawRisk = entryPrice - stop;
                if (stop >= today.Close || (today.Close - stop) / today.Close < 0.005m)
                    continue;

                entryPrice  = today.Close;
                stopPrice   = stop;
                targetPrice = entryPrice * 1.20m;
                entryBarIdx = i;
                inPosition  = true;
                _logger.LogDebug("BT ENTRY {Symbol} @ {Price:F2} on {Date:d}", req.Symbol, entryPrice, today.Time);
            }
            // ── MANAGING OPEN POSITION ──────────────────────────
            else
            {
                int     daysHeld  = i - entryBarIdx;
                string  exitReason = "";
                decimal exitPrice  = 0;

                if (today.Low <= stopPrice)           // stop hit — check first (conservative)
                {
                    exitPrice  = stopPrice;
                    exitReason = "Stop Hit";
                }
                else if (today.High >= targetPrice)   // +20% target hit
                {
                    exitPrice  = targetPrice;
                    exitReason = "Target +20%";
                }
                else if (daysHeld >= 40)              // 8-week time stop
                {
                    exitPrice  = today.Close;
                    exitReason = "Time Stop (8w)";
                }

                if (exitReason == "") continue;

                // Position size: risk exactly riskPercent of current equity
                decimal dollarRisk   = equity * (req.RiskPercent / 100m);
                decimal riskPerShare = entryPrice - stopPrice;
                int     shares       = riskPerShare > 0 ? (int)(dollarRisk / riskPerShare) : 1;
                if (shares < 1) shares = 1;

                decimal pnlDollar = (exitPrice - entryPrice) * shares;
                decimal pnlPct    = (exitPrice - entryPrice) / entryPrice * 100m;
                decimal rMult     = riskPerShare > 0 ? (exitPrice - entryPrice) / riskPerShare : 0;

                equity += pnlDollar;
                if (equity > peak) peak = equity;
                decimal dd = peak > 0 ? (peak - equity) / peak * 100m : 0;
                if (dd > maxDD) maxDD = dd;

                trades.Add(new BacktestTrade
                {
                    EntryDate  = allBars[entryBarIdx].Time,
                    ExitDate   = today.Time,
                    EntryPrice = Math.Round(entryPrice, 2),
                    ExitPrice  = Math.Round(exitPrice, 2),
                    StopPrice  = Math.Round(stopPrice, 2),
                    Target     = Math.Round(targetPrice, 2),
                    DaysHeld   = daysHeld,
                    PnLPct     = Math.Round(pnlPct, 1),
                    RMultiple  = Math.Round(rMult, 2),
                    PnLDollar  = Math.Round(pnlDollar, 2),
                    ExitReason = exitReason,
                });

                equityCurve.Add(new EquityPoint
                {
                    Date   = today.Time.ToString("yyyy-MM-dd"),
                    Equity = Math.Round(equity, 2),
                });

                inPosition = false;
                cooldown   = 5; // brief cooldown so the same breakout isn't re-entered
            }
        }

        // ── SUMMARY STATS ───────────────────────────────────────
        var winners = trades.Where(t => t.PnLPct > 0).ToList();
        var losers  = trades.Where(t => t.PnLPct <= 0).ToList();

        decimal totalGain = winners.Sum(t => t.PnLDollar);
        decimal totalLoss = Math.Abs(losers.Sum(t => t.PnLDollar));

        result.Trades           = trades;
        result.EquityCurve      = equityCurve;
        result.TotalTrades      = trades.Count;
        result.Winners          = winners.Count;
        result.Losers           = losers.Count;
        result.WinRate          = trades.Count > 0 ? Math.Round((decimal)winners.Count / trades.Count * 100, 1) : 0;
        result.AvgGainPct       = winners.Count > 0 ? Math.Round(winners.Average(t => t.PnLPct), 1) : 0;
        result.AvgLossPct       = losers.Count  > 0 ? Math.Round(losers.Average(t => t.PnLPct), 1) : 0;
        result.ProfitFactor     = totalLoss > 0 ? Math.Round(totalGain / totalLoss, 2) : 0;
        result.ExpectancyR      = trades.Count > 0 ? Math.Round(trades.Average(t => t.RMultiple), 2) : 0;
        result.TotalReturnPct   = Math.Round((equity - req.AccountSize) / req.AccountSize * 100, 1);
        result.MaxDrawdownPct   = Math.Round(maxDD, 1);
        result.FinalEquity      = Math.Round(equity, 2);

        return result;
    }

    // Minervini template score (0–7) computed in memory — no API call
    private static int MinerviniScore(List<decimal> closes)
    {
        int n = closes.Count;
        if (n < 200) return 0;

        decimal price      = closes[n - 1];
        decimal ma50       = closes.TakeLast(50).Average();
        decimal ma150      = closes.TakeLast(150).Average();
        decimal ma200      = closes.TakeLast(200).Average();
        decimal ma200_1m   = n >= 221 ? closes.Skip(n - 221).Take(200).Average() : ma200;
        decimal w52High    = n >= 252 ? closes.TakeLast(252).Max() : closes.Max();
        decimal w52Low     = n >= 252 ? closes.TakeLast(252).Min() : closes.Min();

        return new[]
        {
            price > ma150 && price > ma200,   // C1
            ma150 > ma200,                    // C2
            ma200 > ma200_1m,                 // C3 — 200MA trending up 1 month
            ma50 > ma150 && ma50 > ma200,     // C4
            price > ma50,                     // C5
            price >= w52Low  * 1.25m,         // C6
            price >= w52High * 0.75m,         // C7
        }.Count(c => c);
    }
}

// ─── Request / Result DTOs ─────────────────────────────────────
public class BacktestRequest
{
    public string   Symbol      { get; set; } = "";
    public DateTime StartDate   { get; set; }
    public DateTime EndDate     { get; set; }
    public decimal  AccountSize { get; set; } = 100_000;
    public decimal  RiskPercent { get; set; } = 1;
}

public class BacktestTrade
{
    public DateTime EntryDate  { get; set; }
    public DateTime ExitDate   { get; set; }
    public decimal  EntryPrice { get; set; }
    public decimal  ExitPrice  { get; set; }
    public decimal  StopPrice  { get; set; }
    public decimal  Target     { get; set; }
    public int      DaysHeld   { get; set; }
    public decimal  PnLPct     { get; set; }
    public decimal  RMultiple  { get; set; }
    public decimal  PnLDollar  { get; set; }
    public string   ExitReason { get; set; } = "";
}

public class BacktestResult
{
    public string   Symbol         { get; set; } = "";
    public DateTime StartDate      { get; set; }
    public DateTime EndDate        { get; set; }
    public int      TotalTrades    { get; set; }
    public int      Winners        { get; set; }
    public int      Losers         { get; set; }
    public decimal  WinRate        { get; set; }
    public decimal  AvgGainPct     { get; set; }
    public decimal  AvgLossPct     { get; set; }
    public decimal  ProfitFactor   { get; set; }
    public decimal  ExpectancyR    { get; set; }
    public decimal  TotalReturnPct { get; set; }
    public decimal  MaxDrawdownPct { get; set; }
    public decimal  FinalEquity    { get; set; }
    public List<BacktestTrade> Trades      { get; set; } = new();
    public List<EquityPoint>   EquityCurve { get; set; } = new();
}

public class EquityPoint
{
    public string  Date   { get; set; } = "";
    public decimal Equity { get; set; }
}
