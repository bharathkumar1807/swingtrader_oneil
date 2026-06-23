using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SwingTrader.API.Data;
using SwingTrader.API.Models;
using SwingTrader.API.Services;

namespace SwingTrader.API.Controllers;

// ─── Stocks / Screener Controller ────────────────────────────
[ApiController]
[Route("api/[controller]")]
public class StocksController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly AlpacaDataService _alpaca;
    private readonly StockScreenerService _screener;

    public StocksController(AppDbContext db, AlpacaDataService alpaca, StockScreenerService screener)
    {
        _db = db;
        _alpaca = alpaca;
        _screener = screener;
    }

    [HttpGet("snapshot/{symbol}")]
    public async Task<IActionResult> GetSnapshot(string symbol)
    {
        var snapshot = await _alpaca.GetSnapshotAsync(symbol.ToUpper());
        return snapshot == null ? NotFound() : Ok(snapshot);
    }

    [HttpGet("bars/{symbol}")]
    public async Task<IActionResult> GetBars(string symbol, [FromQuery] string timeframe = "1Day", [FromQuery] int limit = 200)
    {
        var tf = timeframe == "1Week" ? Alpaca.Markets.BarTimeFrame.Week : Alpaca.Markets.BarTimeFrame.Day;
        var bars = await _alpaca.GetBarsAsync(symbol.ToUpper(), tf, limit);
        return Ok(bars);
    }

    [HttpGet("moving-averages/{symbol}")]
    public async Task<IActionResult> GetMovingAverages(string symbol)
    {
        var ma = await _alpaca.GetMovingAveragesAsync(symbol.ToUpper());
        return Ok(ma);
    }

    [HttpGet("minervini/{symbol}")]
    public async Task<IActionResult> CheckMinervini(string symbol)
    {
        var result = await _alpaca.CheckMinerviniTemplateAsync(symbol.ToUpper());
        return Ok(result);
    }

    [HttpGet("autosuggest/{symbol}")]
    public async Task<IActionResult> GetAutoSuggest(string symbol)
    {
        var result = await _alpaca.GetAutoSuggestAsync(symbol.ToUpper());
        return Ok(result);
    }

    [HttpPost("seed")]
    public async Task<IActionResult> SeedStocks()
    {
        var universe = new[]
        {
            // Technology
            ("AAPL","Technology"), ("MSFT","Technology"), ("NVDA","Technology"), ("AVGO","Technology"),
            ("AMD","Technology"), ("INTC","Technology"), ("QCOM","Technology"), ("TXN","Technology"),
            ("MU","Technology"), ("AMAT","Technology"), ("LRCX","Technology"), ("KLAC","Technology"),
            ("MCHP","Technology"), ("ON","Technology"), ("ADI","Technology"), ("MRVL","Technology"),
            ("CDNS","Technology"), ("SNPS","Technology"), ("ANSS","Technology"), ("INTU","Technology"),
            ("ADSK","Technology"), ("NOW","Technology"), ("CRM","Technology"), ("ORCL","Technology"),
            ("ADBE","Technology"), ("PANW","Technology"), ("CRWD","Technology"), ("FTNT","Technology"),
            ("ZS","Technology"), ("DDOG","Technology"), ("NET","Technology"), ("PLTR","Technology"),
            ("SNOW","Technology"), ("TEAM","Technology"), ("HUBS","Technology"), ("ARM","Technology"),
            ("SMCI","Technology"), ("DELL","Technology"), ("CSCO","Technology"), ("ACN","Technology"),
            ("IBM","Technology"), ("CTSH","Technology"), ("KEYS","Technology"), ("MPWR","Technology"),
            ("ENPH","Technology"), ("FSLR","Technology"), ("NXPI","Technology"), ("APP","Technology"),
            // Communication
            ("META","Communication"), ("GOOGL","Communication"), ("GOOG","Communication"),
            ("NFLX","Communication"), ("CMCSA","Communication"), ("DIS","Communication"),
            ("T","Communication"), ("VZ","Communication"), ("TMUS","Communication"),
            ("TTWO","Communication"), ("EA","Communication"), ("RBLX","Communication"),
            ("SNAP","Communication"), ("PINS","Communication"), ("SPOT","Communication"),
            // Consumer Discretionary
            ("AMZN","Consumer Discretionary"), ("TSLA","Consumer Discretionary"),
            ("HD","Consumer Discretionary"), ("MCD","Consumer Discretionary"),
            ("NKE","Consumer Discretionary"), ("LOW","Consumer Discretionary"),
            ("TJX","Consumer Discretionary"), ("BKNG","Consumer Discretionary"),
            ("ABNB","Consumer Discretionary"), ("MAR","Consumer Discretionary"),
            ("HLT","Consumer Discretionary"), ("SBUX","Consumer Discretionary"),
            ("CMG","Consumer Discretionary"), ("ORLY","Consumer Discretionary"),
            ("AZO","Consumer Discretionary"), ("DLTR","Consumer Discretionary"),
            ("ROST","Consumer Discretionary"), ("DG","Consumer Discretionary"),
            ("EBAY","Consumer Discretionary"), ("ETSY","Consumer Discretionary"),
            ("YUM","Consumer Discretionary"), ("DPZ","Consumer Discretionary"),
            ("DECK","Consumer Discretionary"), ("LULU","Consumer Discretionary"),
            ("RH","Consumer Discretionary"), ("POOL","Consumer Discretionary"),
            // Consumer Staples
            ("COST","Consumer Staples"), ("WMT","Consumer Staples"), ("PG","Consumer Staples"),
            ("KO","Consumer Staples"), ("PEP","Consumer Staples"), ("PM","Consumer Staples"),
            ("MO","Consumer Staples"), ("MDLZ","Consumer Staples"), ("CL","Consumer Staples"),
            ("MNST","Consumer Staples"), ("KDP","Consumer Staples"), ("HSY","Consumer Staples"),
            ("TSCO","Consumer Staples"), ("ELF","Consumer Staples"),
            // Healthcare
            ("LLY","Healthcare"), ("UNH","Healthcare"), ("JNJ","Healthcare"), ("ABT","Healthcare"),
            ("PFE","Healthcare"), ("MRK","Healthcare"), ("AMGN","Healthcare"), ("GILD","Healthcare"),
            ("BIIB","Healthcare"), ("REGN","Healthcare"), ("VRTX","Healthcare"), ("ISRG","Healthcare"),
            ("MDT","Healthcare"), ("EW","Healthcare"), ("BSX","Healthcare"), ("SYK","Healthcare"),
            ("IDXX","Healthcare"), ("DXCM","Healthcare"), ("MRNA","Healthcare"), ("TMO","Healthcare"),
            ("DHR","Healthcare"), ("A","Healthcare"), ("IQV","Healthcare"), ("PODD","Healthcare"),
            ("GEHC","Healthcare"), ("RVTY","Healthcare"), ("HOLX","Healthcare"),
            // Financials
            ("JPM","Financials"), ("BAC","Financials"), ("WFC","Financials"), ("GS","Financials"),
            ("MS","Financials"), ("BLK","Financials"), ("AXP","Financials"), ("V","Financials"),
            ("MA","Financials"), ("COF","Financials"), ("USB","Financials"), ("TFC","Financials"),
            ("SCHW","Financials"), ("ICE","Financials"), ("CME","Financials"), ("NDAQ","Financials"),
            ("MCO","Financials"), ("SPGI","Financials"), ("CBOE","Financials"), ("PYPL","Financials"),
            ("SQ","Financials"), ("COIN","Financials"),
            // Industrials
            ("HON","Industrials"), ("CAT","Industrials"), ("DE","Industrials"), ("GE","Industrials"),
            ("RTX","Industrials"), ("LMT","Industrials"), ("NOC","Industrials"), ("GD","Industrials"),
            ("BA","Industrials"), ("AXON","Industrials"), ("UPS","Industrials"), ("FDX","Industrials"),
            ("ODFL","Industrials"), ("CPRT","Industrials"), ("PCAR","Industrials"),
            ("FAST","Industrials"), ("GWW","Industrials"), ("EMR","Industrials"),
            ("ETN","Industrials"), ("ROK","Industrials"), ("CTAS","Industrials"),
            ("PAYX","Industrials"), ("ADP","Industrials"), ("VRSK","Industrials"),
            ("UBER","Industrials"), ("TT","Industrials"), ("IR","Industrials"),
            // Energy
            ("XOM","Energy"), ("CVX","Energy"), ("COP","Energy"), ("EOG","Energy"),
            ("MPC","Energy"), ("PSX","Energy"), ("VLO","Energy"), ("HAL","Energy"),
            ("SLB","Energy"), ("OXY","Energy"), ("DVN","Energy"), ("FANG","Energy"),
            // Materials
            ("LIN","Materials"), ("APD","Materials"), ("SHW","Materials"), ("DD","Materials"),
            ("DOW","Materials"), ("ECL","Materials"), ("NEM","Materials"), ("FCX","Materials"),
            ("NUE","Materials"), ("STLD","Materials"),
            // Real Estate
            ("AMT","Real Estate"), ("PLD","Real Estate"), ("EQIX","Real Estate"),
            ("CCI","Real Estate"), ("SBAC","Real Estate"),
            // Utilities
            ("NEE","Utilities"), ("SO","Utilities"), ("DUK","Utilities"),
            ("AEP","Utilities"), ("CEG","Utilities"), ("VST","Utilities"),

            // ── Midcap Growth ($1B–$15B market cap) ──────────────────
            // Technology – Software / Cloud / SaaS
            ("DUOL","Technology"), ("GTLB","Technology"), ("PCTY","Technology"),
            ("SPSC","Technology"), ("QLYS","Technology"), ("DOCN","Technology"),
            ("FRSH","Technology"), ("BRZE","Technology"), ("WK","Technology"),
            ("FROG","Technology"), ("VERX","Technology"), ("ALTR","Technology"),
            ("CWAN","Technology"), ("NCNO","Technology"), ("JAMF","Technology"),
            ("ZI","Technology"), ("S","Technology"),
            // Technology – Semiconductors (midcap)
            ("CRUS","Technology"), ("AMBA","Technology"), ("ACLS","Technology"),
            ("CRDO","Technology"), ("FORM","Technology"), ("POWI","Technology"),
            ("SITM","Technology"),
            // Communication (midcap)
            ("DV","Communication"), ("IAS","Communication"), ("ZG","Communication"),
            // Consumer Discretionary (midcap)
            ("CAVA","Consumer Discretionary"), ("BOOT","Consumer Discretionary"),
            ("WING","Consumer Discretionary"), ("SFM","Consumer Discretionary"),
            ("CHWY","Consumer Discretionary"), ("FIVE","Consumer Discretionary"),
            ("EAT","Consumer Discretionary"), ("TXRH","Consumer Discretionary"),
            ("BJ","Consumer Discretionary"),
            // Consumer Staples (midcap)
            ("CELH","Consumer Staples"), ("FRPT","Consumer Staples"),
            ("VITL","Consumer Staples"),
            // Healthcare – Medtech / Biotech (midcap)
            ("INSP","Healthcare"), ("IRTC","Healthcare"), ("TMDX","Healthcare"),
            ("HIMS","Healthcare"), ("KRYS","Healthcare"), ("PCVX","Healthcare"),
            ("ACAD","Healthcare"), ("RXST","Healthcare"), ("DNLI","Healthcare"),
            ("ARWR","Healthcare"), ("RARE","Healthcare"),
            // Financials (midcap)
            ("AFRM","Financials"), ("SOFI","Financials"), ("UPST","Financials"),
            ("RYAN","Financials"),
            // Industrials (midcap / defense-tech)
            ("KTOS","Industrials"), ("RKLB","Industrials"), ("ESAB","Industrials"),
            ("GNRC","Industrials"),
            // Energy (midcap E&P)
            ("CIVI","Energy"), ("CHRD","Energy"), ("SM","Energy"),
        };

        var existing = (await _db.Stocks.Select(s => s.Symbol).ToListAsync()).ToHashSet();
        var toAdd = universe
            .Where(u => !existing.Contains(u.Item1))
            .Select(u => new Stock { Symbol = u.Item1, Sector = u.Item2 })
            .ToList();

        _db.Stocks.AddRange(toAdd);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            message = $"Seeded {toAdd.Count} new stocks. {existing.Count} already existed.",
            total = toAdd.Count + existing.Count,
            added = toAdd.Select(s => s.Symbol)
        });
    }

    [HttpPost("fundamentals/run")]
    public async Task<IActionResult> RunFundamentals([FromServices] IServiceScopeFactory scopeFactory)
    {
        var count = await _db.Stocks.CountAsync();
        _ = Task.Run(async () =>
        {
            // Must create a new DI scope — the request scope is disposed before this task finishes
            using var scope = scopeFactory.CreateScope();
            var yahoo = scope.ServiceProvider.GetRequiredService<YahooFinanceService>();
            await yahoo.RefreshFundamentals();
        });
        return Ok(new
        {
            message = $"Fundamentals refresh started for {count} stocks. Runs in background (~{count / 3} seconds). Check logs for progress.",
            stockCount = count
        });
    }

    [HttpGet("screener")]
    public async Task<IActionResult> GetScreenerResults([FromQuery] DateTime? date = null)
    {
        var scanDate = date ?? DateTime.UtcNow.Date;
        var results = await _db.ScreenerResults
            .Where(r => r.ScanDate.Date == scanDate)
            .OrderByDescending(r => r.MinerviniScore)
            .ThenByDescending(r => r.RsRating)
            .ToListAsync();
        return Ok(results);
    }

    [HttpPost("screener/run")]
    public async Task<IActionResult> RunScreener([FromServices] IServiceScopeFactory scopeFactory)
    {
        var count = await _db.Stocks.CountAsync();
        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var screener = scope.ServiceProvider.GetRequiredService<StockScreenerService>();
            await screener.RunDailyScreener();
        });
        return Ok(new { message = $"Screener scan started for {count} stocks. Runs in background (~{count / 3} seconds)." });
    }

    [HttpPost]
    public async Task<IActionResult> AddStock([FromBody] Stock stock)
    {
        _db.Stocks.Add(stock);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetSnapshot), new { symbol = stock.Symbol }, stock);
    }
}

// ─── Watchlist Controller ─────────────────────────────────────
[ApiController]
[Route("api/[controller]")]
public class WatchlistController : ControllerBase
{
    private readonly AppDbContext _db;

    public WatchlistController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll() =>
        Ok(await _db.Watchlist.OrderByDescending(w => w.AddedAt).ToListAsync());

    [HttpPost]
    public async Task<IActionResult> Add([FromBody] WatchlistItem item)
    {
        _db.Watchlist.Add(item);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetAll), item);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Remove(int id)
    {
        var item = await _db.Watchlist.FindAsync(id);
        if (item == null) return NotFound();
        _db.Watchlist.Remove(item);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}

// ─── Trade Setup Controller ───────────────────────────────────
[ApiController]
[Route("api/[controller]")]
public class TradesController : ControllerBase
{
    private readonly TradeService _trades;
    private readonly AppDbContext _db;

    public TradesController(TradeService trades, AppDbContext db)
    {
        _trades = trades;
        _db = db;
    }

    [HttpPost("calculate")]
    public IActionResult CalculatePositionSize([FromBody] PositionSizeRequest req) =>
        Ok(_trades.CalculatePositionSize(req.AccountSize, req.RiskPercent, req.EntryPrice, req.StopLoss));

    [HttpPost("setup")]
    public async Task<IActionResult> CreateSetup([FromBody] CreateTradeSetupDto dto)
    {
        var setup = await _trades.CreateSetupAsync(dto);
        return CreatedAtAction(nameof(GetSetups), new { id = setup.Id }, setup);
    }

    [HttpGet("setups")]
    public async Task<IActionResult> GetSetups() =>
        Ok(await _db.TradeSetups.OrderByDescending(t => t.CreatedAt).ToListAsync());

    [HttpPost("activate/{setupId}")]
    public async Task<IActionResult> ActivateTrade(int setupId)
    {
        var position = await _trades.ActivateTradeAsync(setupId);
        return Ok(position);
    }

    [HttpPost("close")]
    public async Task<IActionResult> CloseTrade([FromBody] CloseTradeDto dto)
    {
        var journal = await _trades.CloseTradeAsync(dto);
        return Ok(journal);
    }
}

// ─── Positions Controller ─────────────────────────────────────
[ApiController]
[Route("api/[controller]")]
public class PositionsController : ControllerBase
{
    private readonly PositionService _positions;

    public PositionsController(PositionService positions) => _positions = positions;

    [HttpGet]
    public async Task<IActionResult> GetOpenPositions() =>
        Ok(await _positions.GetOpenPositionsAsync());
}

// ─── Journal Controller ────────────────────────────────────────
[ApiController]
[Route("api/[controller]")]
public class JournalController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly JournalService _journal;

    public JournalController(AppDbContext db, JournalService journal)
    {
        _db = db;
        _journal = journal;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll() =>
        Ok(await _db.TradeJournal.OrderByDescending(j => j.ExitDate).ToListAsync());

    [HttpGet("stats")]
    public async Task<IActionResult> GetStats() =>
        Ok(await _journal.GetPerformanceStatsAsync());

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateJournal(int id, [FromBody] UpdateJournalDto dto)
    {
        var entry = await _db.TradeJournal.FindAsync(id);
        if (entry == null) return NotFound();
        entry.Notes = dto.Notes;
        entry.Grade = dto.Grade;
        await _db.SaveChangesAsync();
        return Ok(entry);
    }
}

// ─── Market Log Controller ─────────────────────────────────────
[ApiController]
[Route("api/[controller]")]
public class MarketController : ControllerBase
{
    private readonly AppDbContext _db;

    public MarketController(AppDbContext db) => _db = db;

    [HttpGet("current")]
    public async Task<IActionResult> GetCurrent() =>
        Ok(await _db.MarketLogs.OrderByDescending(m => m.LogDate).FirstOrDefaultAsync());

    [HttpPost]
    public async Task<IActionResult> LogMarketDirection([FromBody] MarketLog log)
    {
        _db.MarketLogs.Add(log);
        await _db.SaveChangesAsync();
        return Ok(log);
    }
}

// ─── Orders Controller ────────────────────────────────────────
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly AlpacaOrderService _orders;
    private readonly AppDbContext _db;

    public OrdersController(AlpacaOrderService orders, AppDbContext db)
    {
        _orders = orders;
        _db = db;
    }

    // All open orders currently on the Alpaca paper account
    [HttpGet]
    public async Task<IActionResult> GetOpenOrders()
    {
        var orders = await _orders.GetOpenOrdersAsync();
        var result = orders.Select(o => new
        {
            OrderId = o.OrderId,
            Symbol = o.Symbol,
            Side = o.OrderSide.ToString(),
            Type = o.OrderType.ToString(),
            Qty = o.Quantity,
            FilledQty = o.FilledQuantity,
            LimitPrice = o.LimitPrice,
            StopPrice = o.StopPrice,
            Status = o.OrderStatus.ToString(),
            CreatedAt = o.CreatedAtUtc,
            Legs = o.Legs?.Select(l => new
            {
                OrderId = l.OrderId,
                Side = l.OrderSide.ToString(),
                Type = l.OrderType.ToString(),
                StopPrice = l.StopPrice,
                Status = l.OrderStatus.ToString()
            })
        });
        return Ok(result);
    }

    // Status of a single order — use to check if a buy filled
    [HttpGet("{orderId:guid}")]
    public async Task<IActionResult> GetOrder(Guid orderId)
    {
        var order = await _orders.GetOrderAsync(orderId);
        return Ok(new
        {
            OrderId = order.OrderId,
            Symbol = order.Symbol,
            Side = order.OrderSide.ToString(),
            Status = order.OrderStatus.ToString(),
            FilledQty = order.FilledQuantity,
            AverageFillPrice = order.AverageFillPrice,
            FilledAt = order.FilledAtUtc,
            Legs = order.Legs?.Select(l => new
            {
                OrderId = l.OrderId,
                Type = l.OrderType.ToString(),
                StopPrice = l.StopPrice,
                Status = l.OrderStatus.ToString()
            })
        });
    }

    // Cancel an open order (e.g. cancel a pending entry before it fills)
    [HttpDelete("{orderId:guid}")]
    public async Task<IActionResult> CancelOrder(Guid orderId)
    {
        var cancelled = await _orders.CancelOrderAsync(orderId);
        return cancelled ? NoContent() : Conflict("Order could not be cancelled — may already be filled or cancelled.");
    }

    // Check Alpaca for the fill status of a position's buy order.
    // If filled: updates local Position to Open with the actual fill price.
    [HttpPost("sync/{positionId:int}")]
    public async Task<IActionResult> SyncPosition(int positionId)
    {
        var position = await _db.Positions.FindAsync(positionId);
        if (position == null) return NotFound();

        if (string.IsNullOrEmpty(position.AlpacaOrderId))
            return BadRequest("Position has no Alpaca order ID.");

        if (!Guid.TryParse(position.AlpacaOrderId, out var orderGuid))
            return BadRequest("Invalid Alpaca order ID format.");

        var order = await _orders.GetOrderAsync(orderGuid);
        position.AlpacaStatus = order.OrderStatus.ToString();

        if (order.OrderStatus == Alpaca.Markets.OrderStatus.Filled)
        {
            position.Status = "Open";
            position.FillPrice = order.AverageFillPrice;

            // Capture the stop-loss leg ID if it wasn't stored at activation
            if (string.IsNullOrEmpty(position.AlpacaStopOrderId))
            {
                var stopLeg = order.Legs?.Count > 0 ? order.Legs[0] : null;
                position.AlpacaStopOrderId = stopLeg?.OrderId.ToString();
            }
        }

        await _db.SaveChangesAsync();
        return Ok(new
        {
            PositionId = position.Id,
            Symbol = position.Symbol,
            Status = position.Status,
            AlpacaStatus = position.AlpacaStatus,
            FillPrice = position.FillPrice,
            AlpacaStopOrderId = position.AlpacaStopOrderId
        });
    }

    // Current positions and P&L from the Alpaca paper account
    [HttpGet("account/positions")]
    public async Task<IActionResult> GetAlpacaPositions()
    {
        var positions = await _orders.GetAlpacaPositionsAsync();
        var result = positions.Select(p => new
        {
            Symbol = p.Symbol,
            Qty = p.Quantity,
            AvgEntryPrice = p.AverageEntryPrice,
            CurrentPrice = p.AssetCurrentPrice,
            MarketValue = p.MarketValue,
            UnrealizedPnL = p.UnrealizedProfitLoss,
            UnrealizedPnLPct = p.UnrealizedProfitLossPercent,
            Side = p.Side.ToString()
        });
        return Ok(result);
    }

    // Alpaca paper account summary (equity, buying power, cash)
    [HttpGet("account")]
    public async Task<IActionResult> GetAccount()
    {
        var account = await _orders.GetAccountAsync();
        return Ok(new
        {
            Equity = account.Equity,
            BuyingPower = account.BuyingPower,
            Cash = account.TradableCash,
            DaytradeCount = account.DayTradeCount,
            AccountStatus = account.Status.ToString()
        });
    }
}

// ─── Backtest Controller ──────────────────────────────────────
[ApiController]
[Route("api/[controller]")]
public class BacktestController : ControllerBase
{
    private readonly BacktestService _backtest;

    public BacktestController(BacktestService backtest) => _backtest = backtest;

    [HttpPost("run")]
    public async Task<IActionResult> Run([FromBody] BacktestRequest req)
    {
        try
        {
            var result = await _backtest.RunAsync(req);
            return Ok(result);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}

// ─── Import / Trade Report Controller ────────────────────────
[ApiController]
[Route("api/[controller]")]
public class ImportController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly ImportService _import;

    public ImportController(AppDbContext db, ImportService import)
    {
        _db = db;
        _import = import;
    }

    // Create a new 15-day challenge
    [HttpPost("challenge")]
    public async Task<IActionResult> CreateChallenge([FromBody] CreateChallengeDto dto)
    {
        var challenge = new TradeChallenge
        {
            Name            = dto.Name,
            StartDate       = dto.StartDate,
            StartingCapital = dto.StartingCapital,
            TargetDays      = dto.TargetDays,
        };
        _db.TradeChallenges.Add(challenge);
        await _db.SaveChangesAsync();
        return Ok(challenge);
    }

    // List all challenges (summary, no trades)
    [HttpGet("challenges")]
    public async Task<IActionResult> GetChallenges()
    {
        var challenges = await _db.TradeChallenges
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new
            {
                c.Id, c.Name, c.StartDate, c.StartingCapital, c.TargetDays, c.CreatedAt,
                TradeCount = _db.ImportedTrades.Count(t => t.ChallengeId == c.Id),
                DaysElapsed = (DateTime.UtcNow - c.StartDate).Days,
            })
            .ToListAsync();
        return Ok(challenges);
    }

    // Get challenge with all trades + live analysis
    [HttpGet("challenge/{id}")]
    public async Task<IActionResult> GetChallenge(int id)
    {
        var challenge = await _db.TradeChallenges.FindAsync(id);
        if (challenge == null) return NotFound();

        var trades = await _db.ImportedTrades
            .Where(t => t.ChallengeId == id)
            .OrderBy(t => t.ExitDate)
            .ToListAsync();

        var analysis = _import.Analyze(trades, challenge.StartingCapital);

        return Ok(new
        {
            Challenge = challenge,
            Trades    = trades,
            Analysis  = analysis,
            DaysElapsed  = (DateTime.UtcNow - challenge.StartDate).Days,
            DaysRemaining = Math.Max(0, challenge.TargetDays - (DateTime.UtcNow - challenge.StartDate).Days),
        });
    }

    // Upload a CSV or PDF, parse it, save new trades, return updated analysis
    [HttpPost("challenge/{id}/upload")]
    [RequestSizeLimit(10 * 1024 * 1024)] // 10 MB
    public async Task<IActionResult> Upload(int id, IFormFile file)
    {
        var challenge = await _db.TradeChallenges.FindAsync(id);
        if (challenge == null) return NotFound();
        if (file == null || file.Length == 0) return BadRequest("No file provided.");

        try
        {
            using var stream = file.OpenReadStream();
            var newTrades = await _import.ParseAndMatchAsync(stream, file.FileName, id);

            if (newTrades.Count == 0)
                return Ok(new { message = "No new trades found (already imported or no closed trades).", newCount = 0 });

            _db.ImportedTrades.AddRange(newTrades);
            await _db.SaveChangesAsync();

            // Return full updated analysis
            var allTrades = await _db.ImportedTrades
                .Where(t => t.ChallengeId == id)
                .OrderBy(t => t.ExitDate)
                .ToListAsync();

            var analysis = _import.Analyze(allTrades, challenge.StartingCapital);

            return Ok(new
            {
                message      = $"Imported {newTrades.Count} new trade{(newTrades.Count > 1 ? "s" : "")}.",
                newCount     = newTrades.Count,
                totalTrades  = allTrades.Count,
                newTrades,
                analysis,
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = $"Parse failed: {ex.Message}" });
        }
    }

    // Delete a challenge and all its trades
    [HttpDelete("challenge/{id}")]
    public async Task<IActionResult> DeleteChallenge(int id)
    {
        var challenge = await _db.TradeChallenges.FindAsync(id);
        if (challenge == null) return NotFound();
        _db.TradeChallenges.Remove(challenge);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // Standalone daily upload — no challenge, links trades back to TradeSetups
    [HttpPost("upload")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<IActionResult> UploadStandalone(IFormFile file)
    {
        if (file == null || file.Length == 0) return BadRequest("No file provided.");

        try
        {
            using var stream = file.OpenReadStream();
            var result = await _import.UploadStandaloneAsync(stream, file.FileName);
            var newTrades = result.NewTrades;
            var openLots  = result.SyncedLots;
            var newCount  = result.NewCount;

            _db.ImportedTrades.AddRange(newTrades);
            _db.OpenLots.AddRange(openLots);
            await _db.SaveChangesAsync();

            return Ok(new
            {
                message   = newCount == 0
                    ? "No new closed trades found — already imported or positions still open."
                    : $"Imported {newCount} new trade{(newCount > 1 ? "s" : "")}.",
                newTrades = newCount,
                openLots  = openLots.Count,
            });
        }
        catch (ArgumentException ex) { return BadRequest(new { error = ex.Message }); }
        catch (Exception ex) { return BadRequest(new { error = $"Parse failed: {ex.Message}" }); }
    }

    // Daily report — planned setups vs what actually happened in uploaded broker data
    [HttpGet("daily-report")]
    public async Task<IActionResult> GetDailyReport(
        [FromQuery] string? from = null, [FromQuery] string? to = null)
    {
        var fromDate = from != null ? DateTime.Parse(from).Date : DateTime.UtcNow.Date.AddDays(-60);
        var toDate   = to   != null ? DateTime.Parse(to).Date   : DateTime.UtcNow.Date;

        var setups = await _db.TradeSetups
            .Where(s => s.CreatedAt.Date >= fromDate && s.CreatedAt.Date <= toDate)
            .OrderByDescending(s => s.CreatedAt)
            .ToListAsync();

        // Closed trades from standalone uploads
        var closedTrades = await _db.ImportedTrades
            .Where(t => t.ChallengeId == null && t.EntryDate >= fromDate.AddDays(-7))
            .ToListAsync();

        var openLots = await _db.OpenLots.ToListAsync();

        // All dates: setup dates + dates of unplanned trades
        var unplannedTrades = closedTrades.Where(t => t.TradeSetupId == null).ToList();
        var unplannedLots   = openLots.Where(l =>
            !setups.Any(s => s.Symbol == l.Symbol &&
                             l.BuyDate.Date >= s.CreatedAt.Date.AddDays(-1) &&
                             l.BuyDate.Date <= s.CreatedAt.Date.AddDays(5)))
            .ToList();

        var allDates = setups.Select(s => s.CreatedAt.Date)
            .Concat(unplannedTrades.Select(t => t.EntryDate.Date))
            .Concat(unplannedLots.Select(l => l.BuyDate.Date))
            .Distinct()
            .OrderByDescending(d => d);

        var report = allDates.Select(date =>
        {
            var daySetups = setups.Where(s => s.CreatedAt.Date == date).ToList();

            var planned = daySetups.Select(setup =>
            {
                var trade = closedTrades.FirstOrDefault(t => t.TradeSetupId == setup.Id);
                if (trade != null)
                    return (object)new
                    {
                        setupId       = setup.Id,
                        symbol        = setup.Symbol,
                        pattern       = setup.Pattern,
                        plannedEntry  = setup.EntryPrice,
                        stopLoss      = setup.StopLoss,
                        notes         = setup.Notes,
                        state         = "Closed",
                        actualEntry   = trade.EntryPrice,
                        actualExit    = trade.ExitPrice,
                        shares        = trade.Shares,
                        pnlDollar     = trade.PnLDollar,
                        pnlPct        = trade.PnLPct,
                        holdDays      = trade.HoldDays,
                        tradeId       = trade.Id,
                    };

                var lot = openLots.FirstOrDefault(l =>
                    l.Symbol == setup.Symbol &&
                    l.BuyDate.Date >= setup.CreatedAt.Date.AddDays(-1) &&
                    l.BuyDate.Date <= setup.CreatedAt.Date.AddDays(5));
                if (lot != null)
                    return (object)new
                    {
                        setupId      = setup.Id,
                        symbol       = setup.Symbol,
                        pattern      = setup.Pattern,
                        plannedEntry = setup.EntryPrice,
                        stopLoss     = setup.StopLoss,
                        notes        = setup.Notes,
                        state        = "Holding",
                        actualEntry  = lot.BuyPrice,
                        actualExit   = (decimal?)null,
                        shares       = lot.Shares,
                        pnlDollar    = (decimal?)null,
                        pnlPct       = (decimal?)null,
                        holdDays     = (int?)Math.Max(0, (DateTime.UtcNow.Date - lot.BuyDate.Date).Days),
                        tradeId      = (int?)null,
                    };

                return (object)new
                {
                    setupId      = setup.Id,
                    symbol       = setup.Symbol,
                    pattern      = setup.Pattern,
                    plannedEntry = setup.EntryPrice,
                    stopLoss     = setup.StopLoss,
                    notes        = setup.Notes,
                    state        = "Planned",
                    actualEntry  = (decimal?)null,
                    actualExit   = (decimal?)null,
                    shares       = (decimal?)null,
                    pnlDollar    = (decimal?)null,
                    pnlPct       = (decimal?)null,
                    holdDays     = (int?)null,
                    tradeId      = (int?)null,
                };
            }).ToList();

            // Unplanned closed trades for this date
            var upTrades = unplannedTrades
                .Where(t => t.EntryDate.Date == date)
                .Select(t => (object)new
                {
                    symbol      = t.Symbol,
                    state       = "Closed",
                    actualEntry = t.EntryPrice,
                    actualExit  = t.ExitPrice,
                    shares      = t.Shares,
                    pnlDollar   = t.PnLDollar,
                    pnlPct      = t.PnLPct,
                    holdDays    = t.HoldDays,
                    tradeId     = t.Id,
                }).ToList();

            // Unplanned open lots for this date
            var upLots = unplannedLots
                .Where(l => l.BuyDate.Date == date)
                .Select(l => (object)new
                {
                    symbol      = l.Symbol,
                    state       = "Holding",
                    actualEntry = l.BuyPrice,
                    actualExit  = (decimal?)null,
                    shares      = l.Shares,
                    pnlDollar   = (decimal?)null,
                    pnlPct      = (decimal?)null,
                    holdDays    = (int?)Math.Max(0, (DateTime.UtcNow.Date - l.BuyDate.Date).Days),
                    tradeId     = (int?)null,
                }).ToList();

            return new
            {
                date      = date.ToString("yyyy-MM-dd"),
                planned,
                unplanned = upTrades.Concat(upLots).ToList(),
            };
        }).ToList();

        return Ok(report);
    }
}

// ─── Telegram Controller ──────────────────────────────────────
[ApiController]
[Route("api/[controller]")]
public class TelegramController : ControllerBase
{
    private readonly TelegramService _telegram;

    public TelegramController(TelegramService telegram) => _telegram = telegram;

    [HttpPost("broadcast")]
    public async Task<IActionResult> Broadcast([FromBody] BroadcastDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Message))
            return BadRequest(new { error = "Message cannot be empty." });

        await _telegram.SendMessageAsync(dto.Message);
        return Ok(new { message = "Broadcast sent." });
    }
}

// ─── DTOs ─────────────────────────────────────────────────────
public class PositionSizeRequest
{
    public decimal AccountSize { get; set; }
    public decimal RiskPercent { get; set; }
    public decimal EntryPrice { get; set; }
    public decimal StopLoss { get; set; }
}

public class UpdateJournalDto
{
    public string Notes { get; set; } = "";
    public string Grade { get; set; } = "";
}

public class BroadcastDto
{
    public string Message { get; set; } = "";
}

public class CreateChallengeDto
{
    public string   Name            { get; set; } = "";
    public DateTime StartDate       { get; set; } = DateTime.UtcNow.Date;
    public decimal  StartingCapital { get; set; } = 2000;
    public int      TargetDays      { get; set; } = 15;
}
