using SwingTrader.API.Data;
using SwingTrader.API.Models;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;

namespace SwingTrader.API.Services;

public class ImportService
{
    private readonly AppDbContext _db;
    private readonly ILogger<ImportService> _logger;

    public ImportService(AppDbContext db, ILogger<ImportService> logger)
    {
        _db = db;
        _logger = logger;
    }

    // ── Parse + match trades from an uploaded file (challenge flow) ──
    public async Task<List<ImportedTrade>> ParseAndMatchAsync(
        Stream fileStream, string fileName, int? challengeId)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        List<RawTx> raw = ext switch
        {
            ".csv" => ParseCsv(fileStream),
            ".pdf" => ParsePdf(fileStream),
            _ => throw new ArgumentException($"Unsupported file type '{ext}'. Upload a .csv or .pdf from Robinhood.")
        };

        _logger.LogInformation("Parsed {Count} raw transactions from {File}", raw.Count, fileName);

        var (trades, _) = MatchFifo(raw);

        // Deduplicate against trades already in this challenge
        if (challengeId.HasValue && trades.Count > 0)
        {
            var existing = await _db.ImportedTrades
                .Where(t => t.ChallengeId == challengeId)
                .Select(t => new { t.Symbol, t.EntryDate, t.ExitDate })
                .ToListAsync();

            var seen = existing
                .Select(e => $"{e.Symbol}|{e.EntryDate:yyyyMMdd}|{e.ExitDate:yyyyMMdd}")
                .ToHashSet();

            trades = trades
                .Where(t => !seen.Contains($"{t.Symbol}|{t.EntryDate:yyyyMMdd}|{t.ExitDate:yyyyMMdd}"))
                .ToList();
        }

        foreach (var t in trades)
            t.ChallengeId = challengeId;

        return trades;
    }

    // ── Parse + match for standalone daily upload (no challenge) ──
    public async Task<(List<ImportedTrade> NewTrades, List<OpenLot> SyncedLots, int NewCount)>
        UploadStandaloneAsync(Stream fileStream, string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        List<RawTx> raw = ext switch
        {
            ".csv" => ParseCsv(fileStream),
            ".pdf" => ParsePdf(fileStream),
            _ => throw new ArgumentException($"Unsupported file type '{ext}'. Upload a .csv or .pdf from Robinhood.")
        };

        _logger.LogInformation("Standalone upload: parsed {Count} raw transactions from {File}", raw.Count, fileName);

        var (trades, openLots) = MatchFifo(raw);

        // Dedup closed trades globally (no challengeId)
        var existingKeys = await _db.ImportedTrades
            .Where(t => t.ChallengeId == null)
            .Select(t => $"{t.Symbol}|{t.EntryDate:yyyyMMdd}|{t.ExitDate:yyyyMMdd}")
            .ToListAsync();
        var seen = existingKeys.ToHashSet();

        var newTrades = trades
            .Where(t => !seen.Contains($"{t.Symbol}|{t.EntryDate:yyyyMMdd}|{t.ExitDate:yyyyMMdd}"))
            .ToList();

        // Auto-link each new closed trade to a TradeSetup
        var allSetups = await _db.TradeSetups.ToListAsync();
        foreach (var trade in newTrades)
        {
            var match = allSetups
                .Where(s => s.Symbol == trade.Symbol &&
                            trade.EntryDate.Date >= s.CreatedAt.Date.AddDays(-1) &&
                            trade.EntryDate.Date <= s.CreatedAt.Date.AddDays(5))
                .OrderBy(s => Math.Abs((s.CreatedAt.Date - trade.EntryDate.Date).Days))
                .FirstOrDefault();
            if (match != null)
                trade.TradeSetupId = match.Id;
        }

        // Sync open lots: replace existing lots for any symbol that appears in this upload
        var uploadedSymbols = raw.Select(r => r.Symbol).ToHashSet();
        var oldLots = await _db.OpenLots
            .Where(l => uploadedSymbols.Contains(l.Symbol))
            .ToListAsync();
        _db.OpenLots.RemoveRange(oldLots);

        return (newTrades, openLots, newTrades.Count);
    }

    // ── CSV parser — Robinhood transaction history format ───────
    private List<RawTx> ParseCsv(Stream stream)
    {
        var result = new List<RawTx>();
        using var reader = new StreamReader(stream);

        var header = reader.ReadLine();
        if (header == null) return result;

        var cols = header.Split(',').Select(h => h.Trim('"').Trim().ToLowerInvariant()).ToArray();

        int iDate   = IndexOf(cols, "activity date", "date");
        int iSym    = IndexOf(cols, "instrument", "symbol");
        int iCode   = IndexOf(cols, "trans code", "type", "action");
        int iQty    = IndexOf(cols, "quantity", "shares", "qty");
        int iPrice  = IndexOf(cols, "price");

        if (iDate < 0 || iSym < 0 || iCode < 0 || iQty < 0 || iPrice < 0)
            throw new Exception(
                "Could not find required columns in CSV. " +
                "Expected Robinhood 'Activity Date, Instrument, Trans Code, Quantity, Price'.");

        string? line;
        while ((line = reader.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            // Handle quoted fields
            var parts = SplitCsvLine(line);
            if (parts.Length <= Math.Max(iDate, Math.Max(iSym, Math.Max(iCode, Math.Max(iQty, iPrice))))) continue;

            var code = parts[iCode].Trim().ToLower();
            if (code != "buy" && code != "sell") continue;

            var dateStr = parts[iDate].Trim();
            if (!TryParseDate(dateStr, out var date)) continue;

            var symbol = parts[iSym].Trim().ToUpperInvariant();
            if (string.IsNullOrEmpty(symbol)) continue;

            var priceStr = parts[iPrice].Trim().Replace("$", "").Replace(",", "");
            if (!decimal.TryParse(priceStr, NumberStyles.Any, CultureInfo.InvariantCulture, out var price)) continue;
            if (!decimal.TryParse(parts[iQty].Trim(), NumberStyles.Any, CultureInfo.InvariantCulture, out var qty)) continue;

            result.Add(new RawTx
            {
                Date = date,
                Symbol = symbol,
                Side = code == "buy" ? Side.Buy : Side.Sell,
                Qty = qty,
                Price = price,
            });
        }

        return result;
    }

    // ── PDF parser — reconstructs lines from word positions ─────
    private List<RawTx> ParsePdf(Stream stream)
    {
        var result = new List<RawTx>();

        using var pdf = PdfDocument.Open(stream);
        var sb = new StringBuilder();

        foreach (var page in pdf.GetPages())
        {
            // Group words by Y position (rounded to 2 pts) to reconstruct table rows
            var lines = page.GetWords()
                .GroupBy(w => Math.Round(w.BoundingBox.Bottom, 1))
                .OrderByDescending(g => g.Key);

            foreach (var lineGroup in lines)
            {
                var lineText = string.Join(" ",
                    lineGroup.OrderBy(w => w.BoundingBox.Left).Select(w => w.Text));
                sb.AppendLine(lineText);
            }
        }

        var fullText = sb.ToString();

        // Pattern A: Robinhood monthly statement
        // "01/15/2026  Buy  NVDA  10  $495.00"
        var patternA = new Regex(
            @"(\d{1,2}/\d{1,2}/\d{2,4})\s+(Buy|Sell)\s+([A-Z]{1,5})\s+([\d.]+)\s+\$?([\d,]+\.?\d*)",
            RegexOptions.IgnoreCase);

        foreach (Match m in patternA.Matches(fullText))
        {
            if (!TryParseDate(m.Groups[1].Value, out var date)) continue;
            if (!decimal.TryParse(m.Groups[4].Value, NumberStyles.Any, CultureInfo.InvariantCulture, out var qty)) continue;
            if (!decimal.TryParse(m.Groups[5].Value.Replace(",", ""), NumberStyles.Any, CultureInfo.InvariantCulture, out var price)) continue;

            result.Add(new RawTx
            {
                Date = date,
                Symbol = m.Groups[3].Value.ToUpperInvariant(),
                Side = m.Groups[2].Value.Equals("Buy", StringComparison.OrdinalIgnoreCase) ? Side.Buy : Side.Sell,
                Qty = qty,
                Price = price,
            });
        }

        // Pattern B: Robinhood trade confirmation
        // "NVDA  Buy  10  @  $495.00  01/15/2026"
        if (result.Count == 0)
        {
            var patternB = new Regex(
                @"([A-Z]{1,5})\s+(Buy|Sell)\s+([\d.]+)\s+@?\s*\$?([\d,]+\.?\d*)\s+(\d{1,2}/\d{1,2}/\d{2,4})",
                RegexOptions.IgnoreCase);

            foreach (Match m in patternB.Matches(fullText))
            {
                if (!TryParseDate(m.Groups[5].Value, out var date)) continue;
                if (!decimal.TryParse(m.Groups[3].Value, NumberStyles.Any, CultureInfo.InvariantCulture, out var qty)) continue;
                if (!decimal.TryParse(m.Groups[4].Value.Replace(",", ""), NumberStyles.Any, CultureInfo.InvariantCulture, out var price)) continue;

                result.Add(new RawTx
                {
                    Date = date,
                    Symbol = m.Groups[1].Value.ToUpperInvariant(),
                    Side = m.Groups[2].Value.Equals("Buy", StringComparison.OrdinalIgnoreCase) ? Side.Buy : Side.Sell,
                    Qty = qty,
                    Price = price,
                });
            }
        }

        if (result.Count == 0)
            throw new Exception(
                "No transactions found in the PDF. " +
                "Try exporting your Robinhood history as CSV instead — go to Account → Statements & History.");

        return result;
    }

    // ── FIFO trade matching: buy lots → sell lots ───────────────
    // Returns (closed trades, remaining open lots with no matching sell)
    private static (List<ImportedTrade> Trades, List<OpenLot> OpenLots) MatchFifo(List<RawTx> transactions)
    {
        var trades = new List<ImportedTrade>();
        var lots = new Dictionary<string, Queue<(DateTime Date, decimal Shares, decimal Price)>>();

        foreach (var tx in transactions.OrderBy(t => t.Date).ThenBy(t => t.Side))
        {
            lots.TryAdd(tx.Symbol, new Queue<(DateTime, decimal, decimal)>());

            if (tx.Side == Side.Buy)
            {
                lots[tx.Symbol].Enqueue((tx.Date, tx.Qty, tx.Price));
            }
            else
            {
                decimal remaining = tx.Qty;
                while (remaining > 0.0001m && lots[tx.Symbol].Count > 0)
                {
                    var lot = lots[tx.Symbol].Dequeue();
                    decimal matched = Math.Min(remaining, lot.Shares);
                    remaining -= matched;

                    if (lot.Shares - matched > 0.0001m)
                        lots[tx.Symbol].Enqueue((lot.Date, lot.Shares - matched, lot.Price));

                    var pnl    = (tx.Price - lot.Price) * matched;
                    var pnlPct = lot.Price > 0 ? (tx.Price - lot.Price) / lot.Price * 100 : 0;

                    trades.Add(new ImportedTrade
                    {
                        Symbol     = tx.Symbol,
                        EntryDate  = lot.Date,
                        ExitDate   = tx.Date,
                        EntryPrice = lot.Price,
                        ExitPrice  = tx.Price,
                        Shares     = matched,
                        PnLDollar  = Math.Round(pnl, 2),
                        PnLPct     = Math.Round(pnlPct, 2),
                        HoldDays   = Math.Max(0, (tx.Date - lot.Date).Days),
                        Source     = "Robinhood",
                        ImportedAt = DateTime.UtcNow,
                    });
                }
            }
        }

        // Remaining lots = bought but not yet sold
        var openLots = lots
            .SelectMany(kv => kv.Value.Select(lot => new OpenLot
            {
                Symbol     = kv.Key,
                BuyDate    = lot.Date,
                BuyPrice   = lot.Price,
                Shares     = lot.Shares,
                Source     = "Robinhood",
                ImportedAt = DateTime.UtcNow,
            }))
            .ToList();

        return (trades.OrderBy(t => t.ExitDate).ToList(), openLots);
    }

    // ── Analysis engine ─────────────────────────────────────────
    public TradeAnalysisResult Analyze(List<ImportedTrade> trades, decimal startingCapital)
    {
        if (trades.Count == 0)
            return new TradeAnalysisResult { StartingCapital = startingCapital };

        var sorted   = trades.OrderBy(t => t.ExitDate).ToList();
        var winners  = sorted.Where(t => t.PnLPct > 0).ToList();
        var losers   = sorted.Where(t => t.PnLPct <= 0).ToList();

        // Equity curve
        decimal equity = startingCapital;
        var curve = new List<EquityCurvePoint>
        {
            new() { Date = sorted[0].EntryDate.ToString("MM/dd"), Equity = startingCapital, Symbol = "" }
        };
        foreach (var t in sorted)
        {
            equity += t.PnLDollar;
            curve.Add(new EquityCurvePoint
            {
                Date   = t.ExitDate.ToString("MM/dd"),
                Equity = Math.Round(equity, 2),
                Symbol = t.Symbol
            });
        }

        // Drawdown
        decimal peak = startingCapital, maxDd = 0;
        foreach (var pt in curve)
        {
            if (pt.Equity > peak) peak = pt.Equity;
            var dd = peak > 0 ? (peak - pt.Equity) / peak * 100 : 0;
            if (dd > maxDd) maxDd = dd;
        }

        // Behavioral flags
        var flags = new List<AnalysisFlag>();
        double avgWinDays  = winners.Any() ? winners.Average(t => t.HoldDays) : 0;
        double avgLossDays = losers.Any()  ? losers.Average(t => t.HoldDays)  : 0;

        if (winners.Any() && losers.Any() && avgLossDays > avgWinDays * 1.5)
            flags.Add(new AnalysisFlag("warning", "Holding losers too long",
                $"Avg winner held {avgWinDays:F0}d but avg loser held {avgLossDays:F0}d — you're letting losses run and cutting winners short."));

        if (winners.Any() && losers.Any() && avgWinDays > avgLossDays * 1.5)
            flags.Add(new AnalysisFlag("good", "Letting winners run",
                $"Avg winner held {avgWinDays:F0}d vs loser {avgLossDays:F0}d — good asymmetry."));

        int earlyExits = winners.Count(t => t.PnLPct < 5m && t.HoldDays <= 3);
        if (winners.Count > 0 && (double)earlyExits / winners.Count >= 0.4)
            flags.Add(new AnalysisFlag("warning", "Exiting winners too early",
                $"{earlyExits}/{winners.Count} winners closed under +5% within 3 days — consider holding to your original target."));

        int bigLosses = losers.Count(t => t.PnLPct < -8m);
        if (bigLosses > 0)
            flags.Add(new AnalysisFlag("warning", "Stop-loss discipline",
                $"{bigLosses} trade{(bigLosses > 1 ? "s" : "")} lost >8% — stops may not be placed or honored."));

        if (winners.Any())
        {
            double avgW = (double)winners.Average(t => t.PnLPct);
            double avgL = losers.Any() ? Math.Abs((double)losers.Average(t => t.PnLPct)) : 1;
            if (avgW > avgL * 1.5)
                flags.Add(new AnalysisFlag("good", "Favorable risk/reward",
                    $"Avg win +{avgW:F1}% vs avg loss -{avgL:F1}% — your winners are bigger than your losses."));
        }

        if (sorted.Count >= 5)
        {
            var bestDay = sorted
                .GroupBy(t => t.EntryDate.DayOfWeek)
                .OrderByDescending(g => g.Average(t => (double)t.PnLPct))
                .First();
            flags.Add(new AnalysisFlag("info", $"Best entry day: {bestDay.Key}",
                $"Avg P&L on {bestDay.Key} entries: {bestDay.Average(t => (double)t.PnLPct):+0.0;-0.0}%"));
        }

        decimal totalLoss = Math.Abs(losers.Sum(t => t.PnLDollar));
        decimal totalWin  = winners.Sum(t => t.PnLDollar);

        return new TradeAnalysisResult
        {
            TotalTrades      = sorted.Count,
            Winners          = winners.Count,
            Losers           = losers.Count,
            WinRate          = Math.Round((decimal)winners.Count / sorted.Count * 100, 1),
            TotalPnL         = Math.Round(sorted.Sum(t => t.PnLDollar), 2),
            TotalPnLPct      = startingCapital > 0
                               ? Math.Round(sorted.Sum(t => t.PnLDollar) / startingCapital * 100, 2) : 0,
            AvgGainPct       = winners.Any() ? Math.Round(winners.Average(t => t.PnLPct), 1) : 0,
            AvgLossPct       = losers.Any()  ? Math.Round(losers.Average(t => t.PnLPct), 1)  : 0,
            ProfitFactor     = totalLoss > 0 ? Math.Round(totalWin / totalLoss, 2) : 0,
            AvgHoldDays      = Math.Round((decimal)sorted.Average(t => t.HoldDays), 1),
            AvgWinHoldDays   = winners.Any() ? Math.Round((decimal)winners.Average(t => t.HoldDays), 1) : 0,
            AvgLossHoldDays  = losers.Any()  ? Math.Round((decimal)losers.Average(t => t.HoldDays), 1)  : 0,
            MaxDrawdownPct   = Math.Round(maxDd, 1),
            CurrentEquity    = Math.Round(equity, 2),
            StartingCapital  = startingCapital,
            EquityCurve      = curve,
            Flags            = flags,
            HoldDistribution = new HoldDistribution
            {
                Day1    = sorted.Count(t => t.HoldDays <= 1),
                Day2to3 = sorted.Count(t => t.HoldDays is >= 2 and <= 3),
                Day4to7 = sorted.Count(t => t.HoldDays is >= 4 and <= 7),
                Day8to14= sorted.Count(t => t.HoldDays is >= 8 and <= 14),
                Over14  = sorted.Count(t => t.HoldDays > 14),
            }
        };
    }

    // ── Helpers ─────────────────────────────────────────────────

    private static int IndexOf(string[] cols, params string[] candidates)
    {
        foreach (var c in candidates)
        {
            var idx = Array.FindIndex(cols, h => h.Contains(c));
            if (idx >= 0) return idx;
        }
        return -1;
    }

    private static bool TryParseDate(string s, out DateTime date)
    {
        return DateTime.TryParseExact(s.Trim(),
            new[] { "MM/dd/yyyy", "M/d/yyyy", "MM/dd/yy", "M/d/yy", "yyyy-MM-dd" },
            CultureInfo.InvariantCulture, DateTimeStyles.None, out date);
    }

    private static string[] SplitCsvLine(string line)
    {
        var result = new List<string>();
        bool inQuote = false;
        var current = new StringBuilder();
        foreach (var ch in line)
        {
            if (ch == '"') { inQuote = !inQuote; continue; }
            if (ch == ',' && !inQuote) { result.Add(current.ToString()); current.Clear(); continue; }
            current.Append(ch);
        }
        result.Add(current.ToString());
        return result.ToArray();
    }
}

// ─── Internal ─────────────────────────────────────────────────
enum Side { Buy, Sell }

class RawTx
{
    public DateTime Date   { get; set; }
    public string   Symbol { get; set; } = "";
    public Side     Side   { get; set; }
    public decimal  Qty    { get; set; }
    public decimal  Price  { get; set; }
}

// ─── Result DTOs ──────────────────────────────────────────────
public class TradeAnalysisResult
{
    public int     TotalTrades     { get; set; }
    public int     Winners         { get; set; }
    public int     Losers          { get; set; }
    public decimal WinRate         { get; set; }
    public decimal TotalPnL        { get; set; }
    public decimal TotalPnLPct     { get; set; }
    public decimal AvgGainPct      { get; set; }
    public decimal AvgLossPct      { get; set; }
    public decimal ProfitFactor    { get; set; }
    public decimal AvgHoldDays     { get; set; }
    public decimal AvgWinHoldDays  { get; set; }
    public decimal AvgLossHoldDays { get; set; }
    public decimal MaxDrawdownPct  { get; set; }
    public decimal CurrentEquity   { get; set; }
    public decimal StartingCapital { get; set; }
    public List<EquityCurvePoint> EquityCurve      { get; set; } = new();
    public List<AnalysisFlag>     Flags             { get; set; } = new();
    public HoldDistribution       HoldDistribution  { get; set; } = new();
}

public class EquityCurvePoint
{
    public string  Date   { get; set; } = "";
    public decimal Equity { get; set; }
    public string  Symbol { get; set; } = "";
}

public class AnalysisFlag
{
    public AnalysisFlag(string type, string title, string detail)
    {
        Type = type; Title = title; Detail = detail;
    }
    public string Type   { get; set; } // "warning" | "good" | "info"
    public string Title  { get; set; }
    public string Detail { get; set; }
}

public class HoldDistribution
{
    public int Day1    { get; set; }
    public int Day2to3 { get; set; }
    public int Day4to7 { get; set; }
    public int Day8to14{ get; set; }
    public int Over14  { get; set; }
}
