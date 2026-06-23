using Microsoft.EntityFrameworkCore;
using SwingTrader.API.Models;

namespace SwingTrader.API.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Stock> Stocks => Set<Stock>();
    public DbSet<WatchlistItem> Watchlist => Set<WatchlistItem>();
    public DbSet<TradeSetup> TradeSetups => Set<TradeSetup>();
    public DbSet<Position> Positions => Set<Position>();
    public DbSet<TradeJournal> TradeJournal => Set<TradeJournal>();
    public DbSet<ScreenerResult> ScreenerResults => Set<ScreenerResult>();
    public DbSet<MarketLog> MarketLogs => Set<MarketLog>();
    public DbSet<Alert> Alerts => Set<Alert>();
    public DbSet<BotSubscriber> BotSubscribers => Set<BotSubscriber>();
    public DbSet<TradeChallenge> TradeChallenges => Set<TradeChallenge>();
    public DbSet<ImportedTrade> ImportedTrades => Set<ImportedTrade>();
    public DbSet<OpenLot> OpenLots => Set<OpenLot>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // TradeSetup → Position (one-to-one)
        modelBuilder.Entity<TradeSetup>()
            .HasOne(t => t.Position)
            .WithOne(p => p.TradeSetup)
            .HasForeignKey<Position>(p => p.TradeSetupId);

        // Position → TradeJournal (one-to-one)
        modelBuilder.Entity<Position>()
            .HasOne(p => p.Journal)
            .WithOne(j => j.Position)
            .HasForeignKey<TradeJournal>(j => j.PositionId);

        modelBuilder.Entity<BotSubscriber>()
            .HasKey(b => b.ChatId);

        modelBuilder.Entity<TradeChallenge>()
            .HasMany(c => c.Trades)
            .WithOne(t => t.Challenge)
            .HasForeignKey(t => t.ChallengeId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<ImportedTrade>(e => {
            e.Property(t => t.EntryPrice).HasPrecision(18, 4);
            e.Property(t => t.ExitPrice).HasPrecision(18, 4);
            e.Property(t => t.Shares).HasPrecision(18, 6);
            e.Property(t => t.PnLDollar).HasPrecision(18, 2);
            e.Property(t => t.PnLPct).HasPrecision(18, 4);
            e.HasOne(t => t.Setup)
             .WithMany()
             .HasForeignKey(t => t.TradeSetupId)
             .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<OpenLot>(e => {
            e.Property(o => o.BuyPrice).HasPrecision(18, 4);
            e.Property(o => o.Shares).HasPrecision(18, 6);
        });

        modelBuilder.Entity<TradeChallenge>(e => {
            e.Property(c => c.StartingCapital).HasPrecision(18, 2);
        });

        // Decimal precision for financial data
        modelBuilder.Entity<TradeSetup>(e => {
            e.Property(t => t.EntryPrice).HasPrecision(18, 4);
            e.Property(t => t.StopLoss).HasPrecision(18, 4);
            e.Property(t => t.Target1R).HasPrecision(18, 4);
            e.Property(t => t.Target20Pct).HasPrecision(18, 4);
            e.Property(t => t.PositionSize).HasPrecision(18, 2);
            e.Property(t => t.AccountSize).HasPrecision(18, 2);
        });

        modelBuilder.Entity<Position>(e => {
            e.Property(p => p.EntryPrice).HasPrecision(18, 4);
            e.Property(p => p.FillPrice).HasPrecision(18, 4);
            e.Property(p => p.CurrentPrice).HasPrecision(18, 4);
            e.Property(p => p.UnrealizedPnL).HasPrecision(18, 2);
            e.Property(p => p.UnrealizedPnLPct).HasPrecision(18, 4);
            e.Property(p => p.StopLoss).HasPrecision(18, 4);
        });

        modelBuilder.Entity<TradeJournal>(e => {
            e.Property(j => j.EntryPrice).HasPrecision(18, 4);
            e.Property(j => j.ExitPrice).HasPrecision(18, 4);
            e.Property(j => j.RealizedPnL).HasPrecision(18, 2);
            e.Property(j => j.RealizedPnLPct).HasPrecision(18, 4);
        });
    }
}
