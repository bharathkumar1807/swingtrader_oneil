using Microsoft.EntityFrameworkCore;
using SwingTrader.API.Data;
using System.Net;

namespace SwingTrader.API.Services;

public class PlanAlertService
{
    private readonly AppDbContext _db;
    private readonly AlpacaDataService _alpaca;
    private readonly TelegramService _telegram;
    private readonly ILogger<PlanAlertService> _logger;

    private static readonly string[] NumberEmoji = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣"];

    public PlanAlertService(
        AppDbContext db,
        AlpacaDataService alpaca,
        TelegramService telegram,
        ILogger<PlanAlertService> logger)
    {
        _db = db;
        _alpaca = alpaca;
        _telegram = telegram;
        _logger = logger;
    }

    // Runs at 9:30 AM ET (13:30 UTC) weekdays — sends top 5 plans ranked by score
    public async Task SendDailySummaryAsync()
    {
        var plans = await _db.TradeSetups
            .Where(t => t.Status == "Planned")
            .OrderByDescending(t => t.MinerviniScore + t.CanslimScore)
            .ThenByDescending(t => t.MinerviniScore)
            .Take(5)
            .ToListAsync();

        if (plans.Count == 0)
        {
            await _telegram.SendMessageAsync("📋 <b>No planned setups for today.</b>\nAdd some via the app.");
            return;
        }

        var today = DateTime.UtcNow.ToString("ddd dd MMM yyyy");
        var lines = new System.Text.StringBuilder();
        lines.AppendLine($"📋 <b>TOP {plans.Count} SWING PLANS — {today}</b>");
        lines.AppendLine("━━━━━━━━━━━━━━━━━━━━━━");

        for (int i = 0; i < plans.Count; i++)
        {
            var p = plans[i];
            var riskPerShare = p.EntryPrice - p.StopLoss;
            var riskPct      = p.EntryPrice > 0 ? riskPerShare / p.EntryPrice * 100 : 0;
            var rr           = riskPerShare > 0 ? (p.Target20Pct - p.EntryPrice) / riskPerShare : 0;
            var totalScore   = p.MinerviniScore + p.CanslimScore;
            var pattern      = WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(p.Pattern) ? "—" : p.Pattern);
            var notes        = WebUtility.HtmlEncode(p.Notes);

            lines.AppendLine();
            lines.AppendLine($"{NumberEmoji[i]} <b>{p.Symbol}</b>  |  {pattern}  |  Score <b>{totalScore}/11</b>");
            lines.AppendLine();
            lines.AppendLine($"💰 Buy: <code>${p.EntryPrice:F2}</code>");
            lines.AppendLine($"🛑 Stop: <code>${p.StopLoss:F2}</code>  ({riskPct:F1}% risk)");
            lines.AppendLine($"📐 Risk/Reward: 1 : {rr:F1}");
            lines.AppendLine();
            lines.AppendLine("🎯 <b>Profit Phases:</b>");
            lines.AppendLine($"   Phase 1 — Minervini 1R: <code>${p.Target1R:F2}</code>  → sell ⅓");
            lines.AppendLine($"   Phase 2 — O'Neil +20%:  <code>${p.Target20Pct:F2}</code>  → sell ⅓");
            lines.AppendLine($"   Phase 3 — Minervini 3R: <code>${p.Target3R:F2}</code>  → trail rest");
            lines.AppendLine();
            lines.AppendLine($"📊 CANSLIM: <b>{p.CanslimScore}/4</b>  |  🔬 Minervini: <b>{p.MinerviniScore}/7</b>");

            if (!string.IsNullOrWhiteSpace(notes))
                lines.AppendLine($"📝 {notes}");

            if (i < plans.Count - 1)
                lines.AppendLine("\n─────────────────────");
        }

        await _telegram.SendMessageAsync(lines.ToString());
        _logger.LogInformation("Daily summary sent — {Count} plans", plans.Count);
    }

    // Called every 5 minutes during market hours via Hangfire
    public async Task CheckPlannedEntriesAsync()
    {
        var plans = await _db.TradeSetups
            .Where(t => t.Status == "Planned" && !t.TelegramAlerted)
            .ToListAsync();

        if (plans.Count == 0) return;

        _logger.LogInformation("Checking {Count} planned setups for breakouts...", plans.Count);

        foreach (var plan in plans)
        {
            try
            {
                var snapshot = await _alpaca.GetSnapshotAsync(plan.Symbol);
                if (snapshot == null) continue;

                decimal currentPrice = snapshot.LatestPrice;

                if (currentPrice < plan.EntryPrice) continue;

                // Price has reached or exceeded the planned entry — fire alert
                decimal riskPct = plan.EntryPrice > 0
                    ? Math.Round((plan.EntryPrice - plan.StopLoss) / plan.EntryPrice * 100, 1)
                    : 0;
                decimal chasePct = Math.Round((currentPrice - plan.EntryPrice) / plan.EntryPrice * 100, 1);

                string pattern = WebUtility.HtmlEncode(plan.Pattern);
                string notes   = WebUtility.HtmlEncode(plan.Notes);

                string chaseWarning = chasePct > 3
                    ? $"\n⚠️ <b>Chasing +{chasePct}% above entry</b>"
                    : "";

                string message = $"""
                    🚀 <b>BREAKOUT — {plan.Symbol}</b>{(string.IsNullOrWhiteSpace(pattern) ? "" : $"\nPattern: {pattern}")}

                    💰 <b>Buy:</b> <code>${plan.EntryPrice:F2}</code>
                    🛑 <b>Stop Loss:</b> <code>${plan.StopLoss:F2}</code> ({riskPct}% risk)
                    🎯 <b>Target +20%:</b> <code>${plan.Target20Pct:F2}</code>
                    📊 <b>Target 1R:</b> <code>${plan.Target1R:F2}</code>
                    📈 <b>Target 3R:</b> <code>${plan.Target3R:F2}</code>

                    Current: <code>${currentPrice:F2}</code>{chaseWarning}
                    Shares: {plan.Shares} | Size: ${plan.PositionSize:N0}
                    Minervini: {plan.MinerviniScore}/7{(string.IsNullOrWhiteSpace(notes) ? "" : $"\n📝 {notes}")}
                    """;

                await _telegram.SendMessageAsync(message);

                plan.TelegramAlerted = true;
                _logger.LogInformation("Alert sent for {Symbol} @ current ${Price:F2} (entry ${Entry:F2})",
                    plan.Symbol, currentPrice, plan.EntryPrice);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Alert check failed for {Symbol}", plan.Symbol);
            }
        }

        await _db.SaveChangesAsync();
    }
}
