import Foundation

/// 核心预警判定（与桌面端 src/utils/alerts.ts computeAlerts 口径一致）：
/// 基于障碍价与最新价的「距离百分比」(障碍价/现价 − 1) 筛选。
enum AlertEngine {
    struct Reason: Equatable, Codable {
        var label: String
        var tone: Tone
        var date: String?   // 观察日期
        var level: Double?  // 障碍点位
        var gap: Double     // 差距%：负=现价高于障碍，正=现价低于障碍

        enum Tone: String, Equatable, Codable {
            case danger
            case warn
            case info
        }
    }

    struct Item: Identifiable, Equatable, Codable {
        var id: Int
        var title: String
        var code: String
        var structureType: String
        var cur: Double
        var reasons: [Reason]

        /// 视图唯一键：两表 id 各自自增，需要 (结构, id) 联合（Identifiable.id 保持 Int 以兼容 fixtures）。
        var viewID: String {
            structureType + "-" + String(id)
        }
    }

    /// 预警阈值（默认值与桌面端 alertSettingsStore 一致）。
    struct Config: Equatable, Codable {
        var knockOutLeadDays: Int = 5
        var knockOutNearPct: Double = 5
        var couponNearPct: Double = 5
        var knockInNearPct: Double = 10

        static let defaults = Config()
    }

    static func compute(positions: [Position], latestPrices: [String: Double], config: Config) -> [Item] {
        guard !positions.isEmpty, !latestPrices.isEmpty else { return [] }
        let calendar = Calendar.current
        let today = AppDate.startOfToday(calendar: calendar)
        guard let inN = calendar.date(byAdding: .day, value: config.knockOutLeadDays, to: today) else { return [] }
        let leadDays = config.knockOutLeadDays
        var result: [Item] = []

        for position in positions {
            if position.status == .knockedOut || position.status == .matured { continue }
            let code = position.underlyingCode
            guard !code.isEmpty, let cur = latestPrices[code], cur != 0 else { continue }
            let initial = position.initialPrice
            guard initial != 0 else { continue }
            var reasons: [Reason] = []

            // 1) N 天内有敲出观察，且现价距敲出障碍的跌幅在阈值内（或已高于敲出线）
            let koDates = Calc.stringArray(position.knockOutDates)
            let koBars = Calc.numberArray(position.knockOutBarriers)
            let koPairs: [(date: Date, bar: Double)] = koDates.enumerated().compactMap { index, text in
                guard let date = AppDate.parse(text) else { return nil }
                let bar = index < koBars.count ? koBars[index] : 0
                return (date, bar)
            }.sorted { $0.date < $1.date }
            if let nextKo = koPairs.first(where: { $0.date >= today && $0.date <= inN }) {
                let koPrice = initial * nextKo.bar / 100
                let koGap = (koPrice / cur - 1) * 100
                if koGap <= config.knockOutNearPct {
                    reasons.append(Reason(
                        label: koGap < 0
                            ? "\(leadDays)日内敲出观察·已突破敲出线"
                            : "\(leadDays)日内敲出观察·临近敲出线",
                        tone: koGap < 0 ? .danger : .warn,
                        date: AppDate.format(nextKo.date),
                        level: koPrice,
                        gap: koGap
                    ))
                }
            }

            // 2) N 天内有派息观察，且现价距派息障碍的跌幅在阈值内（或已站上派息线）
            let cpDates = Calc.stringArray(position.couponDates).compactMap { AppDate.parse($0) }
            if let cpNext = cpDates.first(where: { $0 >= today && $0 <= inN }),
               position.couponBarrier > 0 {
                let cpPrice = initial * position.couponBarrier
                let cpGap = (cpPrice / cur - 1) * 100
                if cpGap <= config.couponNearPct {
                    reasons.append(Reason(
                        label: cpGap < 0
                            ? "\(leadDays)日内派息观察·已站上派息线"
                            : "\(leadDays)日内派息观察·临近派息线",
                        tone: .info,
                        date: AppDate.format(cpNext),
                        level: cpPrice,
                        gap: cpGap
                    ))
                }
            }

            // 3) 现价距敲入障碍的涨幅在阈值内（含已跌破敲入线）
            if position.knockInBarrier > 0 {
                let kiPrice = initial * position.knockInBarrier
                let kiGap = (kiPrice / cur - 1) * 100
                if kiGap >= -config.knockInNearPct {
                    var kiDate = ""
                    if position.knockInObservation == "daily" {
                        kiDate = "每日观察"
                    } else if position.knockInObservation == "maturity" {
                        let allKo = Calc.stringArray(position.knockOutDates).compactMap { AppDate.parse($0) }.sorted()
                        if let last = allKo.last { kiDate = AppDate.format(last) }
                    }
                    reasons.append(Reason(
                        label: kiGap > 0 ? "已跌破敲入线" : "逼近敲入线",
                        tone: .danger,
                        date: kiDate.isEmpty ? nil : kiDate,
                        level: kiPrice,
                        gap: kiGap
                    ))
                }
            }

            if !reasons.isEmpty {
                result.append(Item(
                    id: position.id,
                    title: position.productName.isEmpty
                        ? (position.contractNo.isEmpty ? "未命名合约" : position.contractNo)
                        : position.productName,
                    code: code,
                    structureType: position.structureType.rawValue,
                    cur: cur,
                    reasons: reasons
                ))
            }
        }
        return result
    }
}
