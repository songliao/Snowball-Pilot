/// 行情与事件相关模型。

/// price_history 表一行。
nonisolated struct PricePoint: Identifiable, Equatable {
    var id: Int
    var underlyingCode: String
    var price: Double
    var date: String
    var source: String
    var open: Double?
    var high: Double?
    var low: Double?
    var volume: Double?
}

/// events 表一行（敲入 / 敲出 / 到期 / 派息登记等）。
nonisolated struct MarketEvent: Identifiable, Equatable {
    var id: Int
    var positionId: Int
    var eventType: String
    var eventDate: String
    var description: String
    var structureType: StructureType
    var createdAt: String
}

/// 实时报价（简版：价格 + 名称）。
nonisolated struct MarketPriceResult: Equatable {
    var price: Double
    var name: String
}

/// 指数完整实时行情。
nonisolated struct IndexQuote: Equatable {
    var code: String
    var name: String
    var price: Double
    var change: Double
    var changePct: Double
    var open: Double
    var high: Double
    var low: Double
    var prevClose: Double
    var volume: Double   // 手
    var amount: Double   // 元
    var updateTime: String
}

/// K 线单根（开高低收 + 成交量）。
nonisolated struct KLinePoint: Equatable {
    var date: String
    var open: Double
    var high: Double
    var low: Double
    var close: Double
    var volume: Double
}

/// 「已存行情标的」汇总行（标的管理页列表）。
nonisolated struct PriceCodeSummary: Identifiable, Equatable {
    var code: String
    var latestPrice: Double
    var date: String
    var prevPrice: Double?
    var priceWeekAgo: Double?
    var priceMonthAgo: Double?
    var priceYearAgo: Double?

    var id: String { code }
}
