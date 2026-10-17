/// 持仓合约核心模型——字段与桌面端 `PositionData` / 数据库列一一对应。
/// 注意：knockInBarrier / maxLossPct / couponBarrier 等百分比字段在 DB 中存小数
/// （0.75 = 75%），表单层显示百分比、提交时 ÷100（与桌面端约定一致）。
nonisolated struct Position: Identifiable, Equatable, Hashable, Codable {
    var id: Int
    var structureType: StructureType

    // 通用簿记
    var productName: String
    var broker: String
    var contractNo: String
    var tradeStartDate: String       // 起息日 YYYY-MM-DD
    var underlyingCode: String
    var notional: Double             // 名义本金
    var initialPrice: Double         // 期初价格

    // 敲入参数
    var knockInBarrier: Double       // 敲入障碍比例（小数）
    var knockInStrike: Double        // 敲入执行价比例（默认 100）
    var knockInObservation: String   // daily | maturity
    var knockInParticipation: Double // 敲入参与率（默认 100）
    var isKi: Bool                   // 敲入状态
    var knockInDate: String          // 敲入日期

    // 敲出参数（序列以 JSON 文本存储）
    var knockOutDates: String        // 敲出观察日序列
    var knockOutBarriers: String     // 敲出障碍比例序列

    // 保证金与最大亏损
    var marginRatio: Double          // 保证金比例（小数）
    var maxLossPct: Double           // 最大亏损（小数）

    // 了结
    var status: PositionStatus
    var terminationDate: String      // 了结日期
    var terminationPayoff: Double    // 了结收益（绝对金额）

    // 返息 / 计息 / 费用
    var rebateAnnualPct: Double
    var rebateAbsoluteBackPct: Double
    var rebateAbsoluteFrontPct: Double
    var accrualBasis: String         // both | one
    var accrualSettleTplus: Int
    var absFeePct: Double
    var annualFeePct: Double
    var incomeDividendPct: Double

    var notes: String

    // 雪球专属
    var knockOutCoupons: String              // 敲出票息序列
    var knockOutEnhanceParticipation: Double // 敲出增强参与率
    var maturityCoupon: Double               // 红利票息

    // 凤凰专属
    var couponBarrier: Double        // 派息障碍比例（小数）
    var couponDates: String          // 派息观察日序列
    var couponRate: Double           // 派息率（小数）
    var couponReceived: String       // 已派息记录（JSON 数组文本）
    var couponPaymentDates: String   // 派息支付日（JSON 日期数组文本）

    var createdAt: String

    /// 全局唯一键：两表 id 各自自增，(结构类型, id) 才是唯一标识（ForEach 等需要用这个）。
    var unionKey: String {
        structureType.rawValue + "-" + String(id)
    }

    init(id: Int = 0, structureType: StructureType = .snowball) {
        self.id = id
        self.structureType = structureType
        self.productName = ""
        self.broker = ""
        self.contractNo = ""
        self.tradeStartDate = ""
        self.underlyingCode = ""
        self.notional = 0
        self.initialPrice = 0
        self.knockInBarrier = 0
        self.knockInStrike = 100
        self.knockInObservation = "daily"
        self.knockInParticipation = 100
        self.isKi = false
        self.knockInDate = ""
        self.knockOutDates = ""
        self.knockOutBarriers = ""
        self.marginRatio = 0
        self.maxLossPct = 0
        self.status = .active
        self.terminationDate = ""
        self.terminationPayoff = 0
        self.rebateAnnualPct = 0
        self.rebateAbsoluteBackPct = 0
        self.rebateAbsoluteFrontPct = 0
        self.accrualBasis = "both"
        self.accrualSettleTplus = 0
        self.absFeePct = 0
        self.annualFeePct = 0
        self.incomeDividendPct = 0
        self.notes = ""
        self.knockOutCoupons = ""
        self.knockOutEnhanceParticipation = 0
        self.maturityCoupon = 0
        self.couponBarrier = 0
        self.couponDates = ""
        self.couponRate = 0
        self.couponReceived = "[]"
        self.couponPaymentDates = "[]"
        self.createdAt = ""
    }
}

nonisolated enum StructureType: String, CaseIterable, Identifiable, Equatable, Codable {
    case snowball
    case phoenix

    var id: String { rawValue }

    var label: String {
        switch self {
        case .snowball: "雪球"
        case .phoenix: "凤凰"
        }
    }
}

nonisolated enum PositionStatus: String, CaseIterable, Identifiable, Equatable, Codable {
    case active
    case knockedIn = "knocked_in"
    case knockedOut = "knocked_out"
    case matured

    var id: String { rawValue }

    init(raw: String) {
        self = PositionStatus(rawValue: raw) ?? .active
    }

    var label: String {
        switch self {
        case .active: "存续中"
        case .knockedIn: "已敲入"
        case .knockedOut: "已敲出"
        case .matured: "已到期"
        }
    }
}
