import Foundation

/// 持仓 CRUD 与状态流转（对应桌面端 electron/database/positions.ts）。
/// nonisolated：连接 FULLMUTEX + WAL，UI 主线程与回填 actor 可并发访问。
nonisolated final class PositionRepository {
    private let db: SQLiteDatabase

    init(database: SQLiteDatabase) {
        self.db = database
    }

    // MARK: - 查询

    /// 全部持仓（两表 UNION，按创建时间倒序）。
    func fetchAll() throws -> [Position] {
        let rows = try db.query(Self.allPositionsSQL)
        return rows.compactMap { Self.position(from: $0) }
    }

    /// 单条持仓。两表 id 各自独立自增，必须带类型才能唯一定位。
    func fetch(id: Int, type: StructureType) throws -> Position? {
        let table = Schema.table(for: type)
        let row = try db.firstRow(
            "SELECT *, '\(type.rawValue)' as structure_type FROM \(table) WHERE id = ?",
            [.int(id)]
        )
        return row.flatMap { Self.position(from: $0) }
    }

    // MARK: - 写入

    /// 新建持仓，返回分配的 id。
    @discardableResult
    func create(_ position: Position) throws -> Int {
        let cols = Schema.columns(for: position.structureType)
        let placeholders = cols.map { _ in "?" }.joined(separator: ", ")
        try db.run(
            """
            INSERT INTO \(Schema.table(for: position.structureType)) (\(cols.joined(separator: ", ")), created_at, updated_at)
            VALUES (\(placeholders), datetime('now','localtime'), datetime('now','localtime'))
            """,
            Self.values(for: position)
        )
        return db.lastInsertRowid()
    }

    /// 全量更新持仓行。
    func update(_ position: Position) throws {
        let cols = Schema.columns(for: position.structureType)
        let assignments = cols.map { "\($0) = ?" }.joined(separator: ", ")
        try db.run(
            """
            UPDATE \(Schema.table(for: position.structureType))
            SET \(assignments), updated_at = datetime('now','localtime')
            WHERE id = ?
            """,
            Self.values(for: position) + [.int(position.id)]
        )
    }

    /// 删除持仓及其事件记录。
    func delete(id: Int, type: StructureType) throws {
        try db.run("DELETE FROM events WHERE position_id = ? AND structure_type = ?",
                   [.int(id), .text(type.rawValue)])
        try db.run("DELETE FROM \(Schema.table(for: type)) WHERE id = ?", [.int(id)])
    }

    /// 状态流转：标记/撤销敲入、了结（敲出/到期）与收益登记。
    /// 参数语义与桌面端 positions:update-status 一致：isKi 标记时写 knockInDate（空串则存 NULL），撤销时清空；
    /// terminationDate / payoff 传 nil 表示不动，payoff 传 .some(nil-等效) 用 cleanTermination 表达清空。
    func updateStatus(
        id: Int,
        type: StructureType,
        status: PositionStatus,
        isKi: Bool? = nil,
        knockInDate: String? = nil,
        terminationDate: String? = nil,
        payoff: Double?? = nil
    ) throws {
        var assignments = ["status = ?"]
        var params: [SQLValue] = [.text(status.rawValue)]

        if let isKi {
            assignments.append("is_ki = ?")
            params.append(.int(isKi ? 1 : 0))
            if isKi {
                assignments.append("knock_in_date = ?")
                params.append(Self.validDateString(knockInDate).map(SQLValue.text) ?? .null)
            } else {
                assignments.append("knock_in_date = NULL")
            }
        }

        if let terminationDate {
            assignments.append("termination_date = ?")
            params.append(Self.validDateString(terminationDate).map(SQLValue.text) ?? .null)
        }

        if let payoff {
            assignments.append("termination_payoff = ?")
            params.append(payoff.map { SQLValue.real($0) } ?? .null)
        }

        assignments.append("updated_at = datetime('now','localtime')")
        params.append(.int(id))

        try db.run(
            "UPDATE \(Schema.table(for: type)) SET \(assignments.joined(separator: ", ")) WHERE id = ?",
            params
        )
    }

    // MARK: - 行映射

    /// UNION 列序：common + 雪球专属 + 凤凰专属（另一类型用占位）+ created_at + structure_type。
    private static func extraSelect(for type: StructureType) -> String {
        let snowballNumeric: Set<String> = ["knock_out_enhance_participation", "maturity_coupon"]
        let phoenixNumeric: Set<String> = ["coupon_barrier", "coupon_rate"]
        let snowballSelect: [String]
        let phoenixSelect: [String]
        if type == .snowball {
            snowballSelect = Schema.snowballExtra
            phoenixSelect = Schema.phoenixExtra.map {
                (phoenixNumeric.contains($0) ? "0" : "''") + " as \($0)"
            }
        } else {
            snowballSelect = Schema.snowballExtra.map {
                (snowballNumeric.contains($0) ? "0" : "''") + " as \($0)"
            }
            phoenixSelect = Schema.phoenixExtra
        }
        return (snowballSelect + phoenixSelect).joined(separator: ", ")
    }

    static let allPositionsSQL = """
    SELECT id, \(Schema.commonColumns.joined(separator: ", ")), \(extraSelect(for: .snowball)), created_at, 'snowball' as structure_type FROM snowball_positions
    UNION ALL
    SELECT id, \(Schema.commonColumns.joined(separator: ", ")), \(extraSelect(for: .phoenix)), created_at, 'phoenix' as structure_type FROM phoenix_positions
    ORDER BY created_at DESC
    """

    /// 从数据库行还原模型（列默认值语义与桌面端 colValue 一致）。
    static func position(from row: SQLRow) -> Position? {
        guard let id = row.int("id"),
              let typeRaw = row.string("structure_type"),
              let type = StructureType(rawValue: typeRaw)
        else { return nil }

        var p = Position(id: id, structureType: type)
        p.productName = row.string("product_name", or: "")
        p.broker = row.string("broker", or: "")
        p.contractNo = row.string("contract_no", or: "")
        p.tradeStartDate = row.string("trade_start_date", or: "")
        p.underlyingCode = row.string("underlying_code", or: "")
        p.notional = row.double("notional", or: 0)
        p.initialPrice = row.double("initial_price", or: 0)
        p.knockInBarrier = row.double("knock_in_barrier", or: 0)
        p.knockInStrike = row.double("knock_in_strike", or: 100)
        p.knockInObservation = row.string("knock_in_observation", or: "daily")
        p.knockInParticipation = row.double("knock_in_participation", or: 100)
        p.isKi = row.bool("is_ki")
        p.knockInDate = row.string("knock_in_date", or: "")
        p.knockOutDates = row.string("knock_out_dates", or: "")
        p.knockOutBarriers = row.string("knock_out_barriers", or: "")
        p.marginRatio = row.double("margin_ratio", or: 0)
        p.maxLossPct = row.double("max_loss_pct", or: 0)
        p.status = PositionStatus(raw: row.string("status", or: "active"))
        p.terminationDate = row.string("termination_date", or: "")
        p.terminationPayoff = row.double("termination_payoff", or: 0)
        p.rebateAnnualPct = row.double("rebate_annual_pct", or: 0)
        p.rebateAbsoluteBackPct = row.double("rebate_absolute_back_pct", or: 0)
        p.rebateAbsoluteFrontPct = row.double("rebate_absolute_front_pct", or: 0)
        p.accrualBasis = row.string("accrual_basis", or: "both")
        p.accrualSettleTplus = row.int("accrual_settle_tplus", or: 0)
        p.absFeePct = row.double("abs_fee_pct", or: 0)
        p.annualFeePct = row.double("annual_fee_pct", or: 0)
        p.incomeDividendPct = row.double("income_dividend_pct", or: 0)
        p.notes = row.string("notes", or: "")
        p.knockOutCoupons = row.string("knock_out_coupons", or: "")
        p.knockOutEnhanceParticipation = row.double("knock_out_enhance_participation", or: 0)
        p.maturityCoupon = row.double("maturity_coupon", or: 0)
        p.couponBarrier = row.double("coupon_barrier", or: 0)
        p.couponDates = row.string("coupon_dates", or: "")
        p.couponRate = row.double("coupon_rate", or: 0)
        p.couponReceived = row.string("coupon_received", or: "[]")
        p.couponPaymentDates = row.string("coupon_payment_dates", or: "[]")
        p.createdAt = row.string("created_at", or: "")
        return p
    }

    /// 模型 → 绑定参数（与列序 Schema.columns(for:) 对应）。
    static func values(for p: Position) -> [SQLValue] {
        Schema.columns(for: p.structureType).map { col in
            switch col {
            case "product_name": .text(p.productName)
            case "broker": .text(p.broker)
            case "contract_no": .text(p.contractNo)
            case "trade_start_date": .text(p.tradeStartDate)
            case "underlying_code": .text(p.underlyingCode)
            case "notional": .real(p.notional)
            case "initial_price": .real(p.initialPrice)
            case "knock_in_barrier": .real(p.knockInBarrier)
            case "knock_in_strike": .real(p.knockInStrike)
            case "margin_ratio": .real(p.marginRatio)
            case "knock_out_dates": .text(p.knockOutDates)
            case "knock_out_barriers": .text(p.knockOutBarriers)
            case "knock_in_observation": .text(p.knockInObservation)
            case "knock_in_participation": .real(p.knockInParticipation)
            case "max_loss_pct": .real(p.maxLossPct)
            case "rebate_annual_pct": .real(p.rebateAnnualPct)
            case "rebate_absolute_back_pct": .real(p.rebateAbsoluteBackPct)
            case "rebate_absolute_front_pct": .real(p.rebateAbsoluteFrontPct)
            case "accrual_basis": .text(p.accrualBasis)
            case "accrual_settle_tplus": .int(p.accrualSettleTplus)
            case "abs_fee_pct": .real(p.absFeePct)
            case "annual_fee_pct": .real(p.annualFeePct)
            case "income_dividend_pct": .real(p.incomeDividendPct)
            case "notes": .text(p.notes)
            case "status": .text(p.status.rawValue)
            case "is_ki": .int(p.isKi ? 1 : 0)
            case "knock_in_date": .text(p.knockInDate)
            case "termination_date": .text(p.terminationDate)
            case "termination_payoff": .real(p.terminationPayoff)
            case "knock_out_coupons": .text(p.knockOutCoupons)
            case "knock_out_enhance_participation": .real(p.knockOutEnhanceParticipation)
            case "maturity_coupon": .real(p.maturityCoupon)
            case "coupon_barrier": .real(p.couponBarrier)
            case "coupon_dates": .text(p.couponDates)
            case "coupon_rate": .real(p.couponRate)
            case "coupon_received": .text(p.couponReceived)
            case "coupon_payment_dates": .text(p.couponPaymentDates)
            default: .text("")
            }
        }
    }

    private static func validDateString(_ value: String?) -> String? {
        guard let value, value.contains(Regex(/^(\d{4})-(\d{2})-(\d{2})$/)) else { return nil }
        return value
    }
}
