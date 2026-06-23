using Microsoft.EntityFrameworkCore;
using SwingTrader.API.Data;
using SwingTrader.API.Hubs;
using SwingTrader.API.Services;
using Hangfire;
using Hangfire.SqlServer;

var builder = WebApplication.CreateBuilder(args);

// ─── Services ───────────────────────────────────────────────
builder.Services.AddControllers().AddJsonOptions(opts =>
    opts.JsonSerializerOptions.ReferenceHandler =
        System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles);
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Database
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

// SignalR (real-time price push)
builder.Services.AddSignalR();

// CORS — allow React dev server
builder.Services.AddCors(options =>
{
    options.AddPolicy("ReactApp", policy =>
        policy.SetIsOriginAllowed(origin => new Uri(origin).Host == "localhost")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials());
});

// App Services
builder.Services.AddSingleton<AlpacaStreamService>();
builder.Services.AddScoped<AlpacaDataService>();
builder.Services.AddScoped<AlpacaOrderService>();
builder.Services.AddScoped<StockScreenerService>();
builder.Services.AddScoped<TradeService>();
builder.Services.AddScoped<PositionService>();
builder.Services.AddScoped<JournalService>();
builder.Services.AddScoped<YahooFinanceService>();
builder.Services.AddScoped<BacktestService>();
builder.Services.AddSingleton<TelegramService>();
builder.Services.AddScoped<PlanAlertService>();
builder.Services.AddScoped<ImportService>();
builder.Services.AddHostedService<TelegramPollingService>();

// Hangfire background jobs
builder.Services.AddHangfire(config =>
    config.SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
          .UseSimpleAssemblyNameTypeSerializer()
          .UseRecommendedSerializerSettings()
          .UseSqlServerStorage(builder.Configuration.GetConnectionString("DefaultConnection")));
builder.Services.AddHangfireServer();

// Create the database before building the app so Hangfire can connect on startup
{
    var connString = builder.Configuration.GetConnectionString("DefaultConnection")!;
    var tempOptions = new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlServer(connString)
        .Options;
    using var tempDb = new AppDbContext(tempOptions);
    tempDb.Database.EnsureCreated();
    // Add any new columns not covered by EnsureCreated (runs safely if already exists)
    tempDb.Database.ExecuteSqlRaw("""
        IF NOT EXISTS (
            SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('TradeSetups') AND name = 'TelegramAlerted'
        )
        ALTER TABLE TradeSetups ADD TelegramAlerted BIT NOT NULL DEFAULT 0
        """);
    tempDb.Database.ExecuteSqlRaw("""
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'BotSubscribers')
        CREATE TABLE BotSubscribers (
            ChatId    BIGINT        NOT NULL PRIMARY KEY,
            FirstName NVARCHAR(100) NOT NULL DEFAULT '',
            Username  NVARCHAR(100) NOT NULL DEFAULT '',
            JoinedAt  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
        )
        """);
    tempDb.Database.ExecuteSqlRaw("""
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TradeChallenges')
        CREATE TABLE TradeChallenges (
            Id               INT           NOT NULL PRIMARY KEY IDENTITY(1,1),
            Name             NVARCHAR(200) NOT NULL DEFAULT '',
            StartDate        DATETIME2     NOT NULL,
            StartingCapital  DECIMAL(18,2) NOT NULL DEFAULT 0,
            TargetDays       INT           NOT NULL DEFAULT 15,
            CreatedAt        DATETIME2     NOT NULL DEFAULT GETUTCDATE()
        )
        """);
    tempDb.Database.ExecuteSqlRaw("""
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ImportedTrades')
        CREATE TABLE ImportedTrades (
            Id           INT            NOT NULL PRIMARY KEY IDENTITY(1,1),
            ChallengeId  INT            NULL REFERENCES TradeChallenges(Id) ON DELETE CASCADE,
            TradeSetupId INT            NULL REFERENCES TradeSetups(Id) ON DELETE SET NULL,
            Symbol       NVARCHAR(10)   NOT NULL DEFAULT '',
            EntryDate    DATETIME2      NOT NULL,
            ExitDate     DATETIME2      NOT NULL,
            EntryPrice   DECIMAL(18,4)  NOT NULL DEFAULT 0,
            ExitPrice    DECIMAL(18,4)  NOT NULL DEFAULT 0,
            Shares       DECIMAL(18,6)  NOT NULL DEFAULT 0,
            PnLDollar    DECIMAL(18,2)  NOT NULL DEFAULT 0,
            PnLPct       DECIMAL(18,4)  NOT NULL DEFAULT 0,
            HoldDays     INT            NOT NULL DEFAULT 0,
            Source       NVARCHAR(50)   NOT NULL DEFAULT 'Robinhood',
            ImportedAt   DATETIME2      NOT NULL DEFAULT GETUTCDATE()
        )
        """);
    tempDb.Database.ExecuteSqlRaw("""
        IF NOT EXISTS (
            SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('ImportedTrades') AND name = 'TradeSetupId'
        )
        ALTER TABLE ImportedTrades ADD TradeSetupId INT NULL REFERENCES TradeSetups(Id) ON DELETE SET NULL
        """);
    tempDb.Database.ExecuteSqlRaw("""
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'OpenLots')
        CREATE TABLE OpenLots (
            Id         INT            NOT NULL PRIMARY KEY IDENTITY(1,1),
            Symbol     NVARCHAR(10)   NOT NULL DEFAULT '',
            BuyDate    DATETIME2      NOT NULL,
            BuyPrice   DECIMAL(18,4)  NOT NULL DEFAULT 0,
            Shares     DECIMAL(18,6)  NOT NULL DEFAULT 0,
            Source     NVARCHAR(50)   NOT NULL DEFAULT 'Robinhood',
            ImportedAt DATETIME2      NOT NULL DEFAULT GETUTCDATE()
        )
        """);
}

var app = builder.Build();

// ─── Middleware ──────────────────────────────────────────────
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("ReactApp");
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<PriceHub>("/hubs/price");
app.UseHangfireDashboard("/hangfire");

// Auto-migrate on startup (dev only) — must run before Hangfire job registration
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    // Add columns that EnsureCreated won't add after initial creation
    db.Database.ExecuteSqlRaw("""
        IF NOT EXISTS (
            SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID('TradeSetups') AND name = 'TelegramAlerted'
        )
        ALTER TABLE TradeSetups ADD TelegramAlerted BIT NOT NULL DEFAULT 0
        """);
}

// ─── Background Jobs Schedule ────────────────────────────────
using (var scope = app.Services.CreateScope())
{
    RecurringJob.AddOrUpdate<StockScreenerService>(
        "daily-screener",
        s => s.RunDailyScreener(),
        "0 21 * * 1-5"); // 4 PM ET weekdays (after market close)

    RecurringJob.AddOrUpdate<YahooFinanceService>(
        "weekly-fundamentals",
        s => s.RefreshFundamentals(),
        "0 8 * * 0"); // Sunday 8 AM

    // Daily top-5 summary at market open: 9:30 AM ET = 13:30 UTC
    RecurringJob.AddOrUpdate<PlanAlertService>(
        "plan-daily-summary",
        s => s.SendDailySummaryAsync(),
        "30 13 * * 1-5");

    // Every 5 minutes during US market hours (9:00 AM–4:05 PM ET = 13:00–20:05 UTC)
    RecurringJob.AddOrUpdate<PlanAlertService>(
        "plan-breakout-alerts",
        s => s.CheckPlannedEntriesAsync(),
        "*/5 13-20 * * 1-5");
}

app.Run();
