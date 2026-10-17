/// 数据库结构定义——与桌面端 `electron/database/schema.ts` 逐列一致。
/// iOS 端只新建库，不做桌面端的历史列迁移。
nonisolated enum Schema {
    static let commonColumns: [String] = [
        "product_name",
        "broker",
        "contract_no",
        "trade_start_date",
        "underlying_code",
        "notional",
        "initial_price",
        "knock_in_barrier",
        "knock_in_strike",
        "margin_ratio",
        "knock_out_dates",
        "knock_out_barriers",
        "knock_in_observation",
        "knock_in_participation",
        "max_loss_pct",
        "rebate_annual_pct",
        "rebate_absolute_back_pct",
        "rebate_absolute_front_pct",
        "accrual_basis",
        "accrual_settle_tplus",
        "abs_fee_pct",
        "annual_fee_pct",
        "income_dividend_pct",
        "notes",
        "status",
        "is_ki",
        "knock_in_date",
        "termination_date",
        "termination_payoff",
    ]

    static let snowballExtra: [String] = [
        "knock_out_coupons",
        "knock_out_enhance_participation",
        "maturity_coupon",
    ]

    static let phoenixExtra: [String] = [
        "coupon_barrier",
        "coupon_dates",
        "coupon_rate",
        "coupon_received",
        "coupon_payment_dates",
    ]

    static let snowballTable = "snowball_positions"
    static let phoenixTable = "phoenix_positions"

    static func columns(for type: StructureType) -> [String] {
        switch type {
        case .snowball: commonColumns + snowballExtra
        case .phoenix: commonColumns + phoenixExtra
        }
    }

    static func table(for type: StructureType) -> String {
        switch type {
        case .snowball: snowballTable
        case .phoenix: phoenixTable
        }
    }

    /// CSV 导出/导入列序（与桌面端 CSV_COLUMNS 完全一致）
    static let csvColumns = ["structure_type"] + commonColumns + snowballExtra + phoenixExtra

    /// CSV 导入时需转数值的列（其余字符串列原样写入）
    static let numericCSVColumns: Set<String> = [
        "notional",
        "initial_price",
        "knock_in_barrier",
        "knock_in_strike",
        "margin_ratio",
        "knock_in_participation",
        "max_loss_pct",
        "rebate_annual_pct",
        "rebate_absolute_back_pct",
        "rebate_absolute_front_pct",
        "accrual_settle_tplus",
        "abs_fee_pct",
        "annual_fee_pct",
        "income_dividend_pct",
        "termination_payoff",
        "knock_out_enhance_participation",
        "maturity_coupon",
        "coupon_barrier",
        "coupon_rate",
    ]

    /// 建表列类型（与桌面端 COL_TYPES 一致，用于动态生成建表语句）
    private static let columnTypes: [String: String] = [
        "product_name": "TEXT DEFAULT ''",
        "broker": "TEXT DEFAULT ''",
        "contract_no": "TEXT DEFAULT ''",
        "underlying_code": "TEXT DEFAULT ''",
        "notional": "REAL DEFAULT 0",
        "initial_price": "REAL DEFAULT 0",
        "knock_out_dates": "TEXT DEFAULT ''",
        "knock_out_barriers": "TEXT DEFAULT ''",
        "knock_in_observation": "TEXT DEFAULT 'daily'",
        "knock_in_participation": "REAL DEFAULT 100",
        "max_loss_pct": "REAL DEFAULT 0",
        "rebate_annual_pct": "REAL DEFAULT 0",
        "rebate_absolute_back_pct": "REAL DEFAULT 0",
        "rebate_absolute_front_pct": "REAL DEFAULT 0",
        "accrual_basis": "TEXT DEFAULT 'both'",
        "accrual_settle_tplus": "INTEGER DEFAULT 0",
        "abs_fee_pct": "REAL DEFAULT 0",
        "annual_fee_pct": "REAL DEFAULT 0",
        "income_dividend_pct": "REAL DEFAULT 0",
        "notes": "TEXT DEFAULT ''",
        "status": "TEXT DEFAULT 'active'",
        "is_ki": "INTEGER DEFAULT 0",
        "knock_in_date": "TEXT DEFAULT ''",
        "knock_out_coupons": "TEXT DEFAULT ''",
        "knock_out_enhance_participation": "REAL DEFAULT 0",
        "trade_start_date": "TEXT DEFAULT ''",
        "knock_in_barrier": "REAL DEFAULT 0",
        "knock_in_strike": "REAL DEFAULT 100",
        "margin_ratio": "REAL DEFAULT 0",
        "maturity_coupon": "REAL DEFAULT 0",
        "termination_date": "TEXT DEFAULT ''",
        "termination_payoff": "REAL DEFAULT 0",
        "coupon_barrier": "REAL DEFAULT 0",
        "coupon_dates": "TEXT DEFAULT ''",
        "coupon_rate": "REAL DEFAULT 0",
        "coupon_received": "TEXT DEFAULT '[]'",
        "coupon_payment_dates": "TEXT DEFAULT '[]'",
    ]

    static func createTableSQL(table: String, columns: [String]) -> String {
        let definitions = columns.map { "\($0) \(columnTypes[$0] ?? "TEXT DEFAULT ''")" }
        return """
        CREATE TABLE IF NOT EXISTS \(table) (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          \(definitions.joined(separator: ",\n  ")),
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        """
    }
}
