using Alpaca.Markets;

namespace SwingTrader.API.Services;

public class AlpacaDataService
{
    private readonly IAlpacaDataClient _dataClient;
    private readonly ILogger<AlpacaDataService> _logger;

    public AlpacaDataService(IConfiguration config, ILogger<AlpacaDataService> logger)
    {
        _logger = logger;
        var apiKey = config["Alpaca:ApiKey"]!;
        var secretKey = config["Alpaca:SecretKey"]!;
        var isPaper = config.GetValue<bool>("Alpaca:IsPaper");

        var environment = isPaper ? Alpaca.Markets.Environments.Paper : Alpaca.Markets.Environments.Live;
        var credentials = new SecretKey(apiKey, secretKey);

        _dataClient = environment.GetAlpacaDataClient(credentials);
    }

    // Get OHLCV bars for chart rendering
    public async Task<List<BarDto>> GetBarsAsync(string symbol, BarTimeFrame timeFrame, int limit = 200)
    {
        // Use a wide-enough window to guarantee `limit` trading days exist in the range,
        // but sort DESCENDING so Alpaca returns the most recent `limit` bars first.
        // Without descending sort, Alpaca fills the page from the oldest end of the
        // window and the most recent bars are cut off when price has moved significantly.
        int calendarDays = (int)(limit * 1.5) + 60;
        var from = DateTime.UtcNow.Date.AddDays(-calendarDays);
        var into = DateTime.UtcNow.Date;

        var request = new HistoricalBarsRequest(symbol, from, into, timeFrame)
        {
            SortDirection = SortDirection.Descending
        };
        request.Pagination.Size = (uint)limit;

        var bars = await _dataClient.ListHistoricalBarsAsync(request);
        // Reverse so the list is oldest→newest for all callers (charts, MA calcs, etc.)
        return bars.Items
            .Reverse()
            .Select(b => new BarDto
            {
                Time = b.TimeUtc,
                Open = b.Open,
                High = b.High,
                Low = b.Low,
                Close = b.Close,
                Volume = (long)b.Volume
            }).ToList();
    }

    // Get latest snapshot (price, volume, prev close)
    public async Task<SnapshotDto?> GetSnapshotAsync(string symbol)
    {
        try
        {
            var snapshot = await _dataClient.GetSnapshotAsync(
                new LatestMarketDataRequest(symbol));

            return new SnapshotDto
            {
                Symbol = symbol,
                LatestPrice = snapshot.CurrentDailyBar?.Close ?? 0,
                PrevClose = snapshot.PreviousDailyBar?.Close ?? 0,
                Volume = (long)(snapshot.CurrentDailyBar?.Volume ?? 0),
                High = snapshot.CurrentDailyBar?.High ?? 0,
                Low = snapshot.CurrentDailyBar?.Low ?? 0
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching snapshot for {Symbol}", symbol);
            return null;
        }
    }

    // Calculate moving averages from bars
    public async Task<MovingAveragesDto> GetMovingAveragesAsync(string symbol)
    {
        var bars = await GetBarsAsync(symbol, BarTimeFrame.Day, 250);
        var closes = bars.Select(b => b.Close).ToList();

        return new MovingAveragesDto
        {
            Symbol = symbol,
            Ma10 = closes.Count >= 10 ? closes.TakeLast(10).Average() : null,
            Ma21 = closes.Count >= 21 ? closes.TakeLast(21).Average() : null,
            Ma50 = closes.Count >= 50 ? closes.TakeLast(50).Average() : null,
            Ma150 = closes.Count >= 150 ? closes.TakeLast(150).Average() : null,
            Ma200 = closes.Count >= 200 ? closes.TakeLast(200).Average() : null,
            Week52High = closes.Count >= 252 ? closes.TakeLast(252).Max() : closes.Max(),
            Week52Low = closes.Count >= 252 ? closes.TakeLast(252).Min() : closes.Min(),
            CurrentPrice = closes.LastOrDefault()
        };
    }

    // Check Minervini template for a symbol
    public async Task<MinerviniTemplateResult> CheckMinerviniTemplateAsync(string symbol)
    {
        // Fetch raw bars once — avoids a second API call vs delegating to GetMovingAveragesAsync
        var bars = await GetBarsAsync(symbol, BarTimeFrame.Day, 250);
        var closes = bars.Select(b => b.Close).ToList();
        int n = closes.Count;

        var result = new MinerviniTemplateResult { Symbol = symbol };
        if (n < 50) return result;

        decimal price = closes[n - 1];
        decimal? ma50  = n >= 50  ? closes.TakeLast(50).Average()  : null;
        decimal? ma150 = n >= 150 ? closes.TakeLast(150).Average() : null;
        decimal? ma200 = n >= 200 ? closes.TakeLast(200).Average() : null;
        decimal week52High = n >= 252 ? closes.TakeLast(252).Max() : closes.Max();
        decimal week52Low  = n >= 252 ? closes.TakeLast(252).Min() : closes.Min();

        // Condition 3: 200MA today > 200MA 21 trading days ago (≈ 1 month of upward slope)
        decimal? ma200_1mAgo = n >= 221 ? closes.Skip(n - 221).Take(200).Average() : null;

        result.Condition1 = ma150.HasValue && ma200.HasValue &&
                            price > ma150.Value && price > ma200.Value;
        result.Condition2 = ma150.HasValue && ma200.HasValue &&
                            ma150.Value > ma200.Value;
        result.Condition3 = ma200.HasValue && ma200_1mAgo.HasValue &&
                            ma200.Value > ma200_1mAgo.Value;
        result.Condition4 = ma50.HasValue && ma150.HasValue && ma200.HasValue &&
                            ma50.Value > ma150.Value && ma50.Value > ma200.Value;
        result.Condition5 = ma50.HasValue && price > ma50.Value;
        result.Condition6 = price >= week52Low * 1.25m;
        result.Condition7 = price >= week52High * 0.75m;
        result.Score = new[] {
            result.Condition1, result.Condition2, result.Condition3,
            result.Condition4, result.Condition5, result.Condition6, result.Condition7
        }.Count(c => c);

        return result;
    }

    // Auto-suggest entry price (pivot high) and stop loss (base low) from recent bars
    public async Task<AutoSuggestDto> GetAutoSuggestAsync(string symbol)
    {
        var bars = await GetBarsAsync(symbol, BarTimeFrame.Day, 50);
        if (bars.Count < 20)
            return new AutoSuggestDto { Symbol = symbol };

        var closes  = bars.Select(b => b.Close).ToList();
        var highs   = bars.Select(b => b.High).ToList();
        var lows    = bars.Select(b => b.Low).ToList();
        var volumes = bars.Select(b => b.Volume).ToList();
        int n = closes.Count;

        // Entry = highest high of last 50 bars → resistance/breakout level
        decimal pivotHigh = highs.Max();
        int pivotIdx      = highs.LastIndexOf(pivotHigh);
        int pivotDaysAgo  = n - 1 - pivotIdx;

        // Stop = lowest low of last 20 bars → base support / pattern-fail level
        decimal baseLow = lows.TakeLast(20).Min();

        decimal currentPrice = closes[n - 1];
        decimal avgVolume    = (decimal)volumes.Average();
        decimal volumeRatio  = avgVolume > 0 ? volumes[n - 1] / avgVolume : 0;

        decimal riskPct  = pivotHigh > 0 ? (pivotHigh - baseLow) / pivotHigh * 100 : 0;
        decimal chasePct = pivotHigh > 0 ? (currentPrice - pivotHigh) / pivotHigh * 100 : 0;

        return new AutoSuggestDto
        {
            Symbol         = symbol,
            SuggestedEntry = Math.Round(pivotHigh, 2),
            SuggestedStop  = Math.Round(baseLow, 2),
            CurrentPrice   = currentPrice,
            RiskPct        = Math.Round(riskPct, 1),
            IsValidRisk    = riskPct <= 8,
            ChasePct       = Math.Round(chasePct, 1),
            IsChasing      = chasePct > 5,
            VolumeRatio    = Math.Round(volumeRatio, 2),
            PivotDaysAgo   = pivotDaysAgo
        };
    }
}

// ─── DTOs ─────────────────────────────────────────────────────
public class BarDto
{
    public DateTime Time { get; set; }
    public decimal Open { get; set; }
    public decimal High { get; set; }
    public decimal Low { get; set; }
    public decimal Close { get; set; }
    public long Volume { get; set; }
}

public class SnapshotDto
{
    public string Symbol { get; set; } = "";
    public decimal LatestPrice { get; set; }
    public decimal PrevClose { get; set; }
    public decimal ChangePct => PrevClose > 0 ? (LatestPrice - PrevClose) / PrevClose * 100 : 0;
    public long Volume { get; set; }
    public decimal High { get; set; }
    public decimal Low { get; set; }
}

public class MovingAveragesDto
{
    public string Symbol { get; set; } = "";
    public decimal CurrentPrice { get; set; }
    public decimal? Ma10 { get; set; }
    public decimal? Ma21 { get; set; }
    public decimal? Ma50 { get; set; }
    public decimal? Ma150 { get; set; }
    public decimal? Ma200 { get; set; }
    public decimal? Week52High { get; set; }
    public decimal? Week52Low { get; set; }
}

public class MinerviniTemplateResult
{
    public string Symbol { get; set; } = "";
    public bool Condition1 { get; set; } // Price > 150MA and 200MA
    public bool Condition2 { get; set; } // 150MA > 200MA
    public bool Condition3 { get; set; } // 200MA trending up 1+ month
    public bool Condition4 { get; set; } // 50MA > 150MA and 200MA
    public bool Condition5 { get; set; } // Price > 50MA
    public bool Condition6 { get; set; } // Price 25% above 52w low
    public bool Condition7 { get; set; } // Price within 25% of 52w high
    public int Score { get; set; }
}

public class AutoSuggestDto
{
    public string Symbol { get; set; } = "";
    public decimal SuggestedEntry { get; set; }   // 50-day pivot high (breakout level)
    public decimal SuggestedStop { get; set; }    // 20-day base low (pattern-fail level)
    public decimal CurrentPrice { get; set; }
    public decimal RiskPct { get; set; }          // % distance between entry and stop
    public bool IsValidRisk { get; set; }         // true if RiskPct <= 8%
    public decimal ChasePct { get; set; }         // % current price is above pivot (>5% = chasing)
    public bool IsChasing { get; set; }
    public decimal VolumeRatio { get; set; }      // today volume / 50d avg volume
    public int PivotDaysAgo { get; set; }         // how many days ago the pivot high occurred
}
