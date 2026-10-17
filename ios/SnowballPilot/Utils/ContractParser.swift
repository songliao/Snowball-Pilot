import Foundation

/// 合约要素文本粘贴解析——与桌面端 src/utils/contractParser.ts 逐规则对齐。
/// 将券商导出的标准要素文本自动映射为表单字段；未识别的键收集进 warnings。
/// 桌面规则之外的补充键：产品名称 / 年化费用 / 收益分红——Parsed 与 apply 本就支持
/// 这三个字段、仅缺键位；补齐后「复制合约」（makeText）导出的文本可完整回填。
enum ContractParser {
    struct Parsed {
        var structureType: StructureType
        var productName: String?
        var contractNo: String?
        var broker: String?
        var underlyingCode: String?
        var notional: Double?
        var tradeStartDate: String?
        var initialPrice: Double?
        var knockOutDates: String?   // 多行文本
        var knockOutBarriers: String?
        var knockOutCoupons: String?
        var knockOutEnhanceParticipation: Double?
        var maturityCoupon: Double?
        var knockInBarrier: Double?
        var knockInObservation: String?
        var knockInStrike: Double?
        var knockInParticipation: Double?
        var marginRatio: Double?
        var maxLossPct: Double?
        var rebateAnnualPct: Double?
        var rebateAbsoluteBackPct: Double?
        var rebateAbsoluteFrontPct: Double?
        var accrualBasis: String?
        var accrualSettleTplus: Double?
        var absFeePct: Double?
        var annualFeePct: Double?
        var incomeDividendPct: Double?
        var couponBarrier: Double?
        var couponRate: Double?
        var couponDates: String?
        var notes: String?
        var warnings: [String]
    }

    /// 应用解析结果到持仓（覆盖已解析字段），供表单「粘贴导入」使用。
    static func apply(_ parsed: Parsed, to position: inout Position) {
        if let v = parsed.productName { position.productName = v }
        if let v = parsed.contractNo { position.contractNo = v }
        if let v = parsed.broker { position.broker = v }
        if let v = parsed.underlyingCode { position.underlyingCode = v }
        if let v = parsed.notional { position.notional = v }
        if let v = parsed.tradeStartDate { position.tradeStartDate = v }
        if let v = parsed.initialPrice { position.initialPrice = v }
        if let v = parsed.knockOutDates { position.knockOutDates = v }
        if let v = parsed.knockOutBarriers { position.knockOutBarriers = v }
        if let v = parsed.knockOutCoupons { position.knockOutCoupons = v }
        if let v = parsed.knockOutEnhanceParticipation { position.knockOutEnhanceParticipation = v / 100 }
        if let v = parsed.maturityCoupon { position.maturityCoupon = v / 100 }
        if let v = parsed.knockInBarrier { position.knockInBarrier = v / 100 }
        if let v = parsed.knockInObservation { position.knockInObservation = v }
        if let v = parsed.knockInStrike { position.knockInStrike = v / 100 }
        if let v = parsed.knockInParticipation { position.knockInParticipation = v / 100 }
        if let v = parsed.marginRatio { position.marginRatio = v / 100 }
        if let v = parsed.maxLossPct { position.maxLossPct = v / 100 }
        if let v = parsed.rebateAnnualPct { position.rebateAnnualPct = v / 100 }
        if let v = parsed.rebateAbsoluteBackPct { position.rebateAbsoluteBackPct = v / 100 }
        if let v = parsed.rebateAbsoluteFrontPct { position.rebateAbsoluteFrontPct = v / 100 }
        if let v = parsed.accrualBasis { position.accrualBasis = v }
        if let v = parsed.accrualSettleTplus { position.accrualSettleTplus = Int(v) }
        if let v = parsed.absFeePct { position.absFeePct = v / 100 }
        if let v = parsed.annualFeePct { position.annualFeePct = v / 100 }
        if let v = parsed.incomeDividendPct { position.incomeDividendPct = v / 100 }
        if let v = parsed.couponBarrier { position.couponBarrier = v / 100 }
        if let v = parsed.couponRate { position.couponRate = v / 100 }
        if let v = parsed.couponDates { position.couponDates = v }
        if let v = parsed.notes { position.notes = v }
    }

    // MARK: - 序列化（复制合约）

    /// 持仓 → 要素文本，与 parse/apply 互逆：复制后走「粘贴合约要素文本自动填充」，各字段还原一致。
    /// 键名全部取自 simpleFields/listFields 映射表；比例字段导出为百分数文本（parse 侧去 % 后 ÷100 还原）；
    /// 序列字段导出为「键名：空值 + 逐行数据」。生命周期字段（敲入/了结状态、日期、收益、已收派息）
    /// 不在要素文本映射范围内，不导出。
    static func makeText(_ position: Position) -> String {
        var lines: [String] = []
        // 产品名称始终导出（空值也带键名）：parse 侧对缺失产品名有「结构类型值兜底」逻辑，
        // 空键名可以显式置空、避免粘贴回填时把产品名错填成「雪球/凤凰」。
        lines.append("产品名称：\(position.productName)")
        if !position.contractNo.isEmpty { lines.append("交易编号：\(position.contractNo)") }
        lines.append("结构类型：\(position.structureType.label)")
        if !position.broker.isEmpty { lines.append("交易对手方：\(position.broker)") }
        if !position.underlyingCode.isEmpty { lines.append("挂钩标的：\(position.underlyingCode)") }
        if position.notional > 0 { lines.append("名义本金：\(jsNumberString(position.notional))") }
        if !position.tradeStartDate.isEmpty { lines.append("交易日期：\(position.tradeStartDate)") }
        if position.initialPrice > 0 { lines.append("期初价格：\(jsNumberString(position.initialPrice))") }
        if position.marginRatio > 0 { lines.append("保证金比例：\(percentText(position.marginRatio))") }
        if position.maxLossPct > 0 { lines.append("最大亏损比例：\(percentText(position.maxLossPct))") }

        let knockOutDates = Calc.stringArray(position.knockOutDates)
        if !knockOutDates.isEmpty {
            lines.append("敲出观察日：")
            lines.append(contentsOf: knockOutDates)
        }
        let knockOutBarriers = Calc.numberArray(position.knockOutBarriers)
        if !knockOutBarriers.isEmpty {
            lines.append("敲出障碍价格：")
            lines.append(contentsOf: knockOutBarriers.map(jsNumberString))
        }

        switch position.structureType {
        case .snowball:
            let coupons = Calc.numberArray(position.knockOutCoupons)
            if !coupons.isEmpty {
                lines.append("敲出票息：")
                lines.append(contentsOf: coupons.map(jsNumberString))
            }
            if position.maturityCoupon > 0 {
                lines.append("红利票息：\(percentText(position.maturityCoupon))")
            }
            if position.knockOutEnhanceParticipation > 0 {
                lines.append("敲出增强参与率：\(percentText(position.knockOutEnhanceParticipation))")
            }
            if position.knockInBarrier > 0 {
                lines.append("敲入障碍价格：\(percentText(position.knockInBarrier))")
            }
            if !position.knockInObservation.isEmpty {
                lines.append("敲入观察方式：\(position.knockInObservation)")
            }
            if position.knockInStrike > 0 {
                lines.append("敲入执行价格：\(percentText(position.knockInStrike))")
            }
            if position.knockInParticipation > 0 {
                lines.append("敲入参与率：\(percentText(position.knockInParticipation))")
            }
        case .phoenix:
            if position.couponBarrier > 0 {
                lines.append("派息障碍价格：\(percentText(position.couponBarrier))")
            }
            if position.couponRate > 0 {
                lines.append("派息率：\(percentText(position.couponRate))")
            }
            let couponDates = Calc.stringArray(position.couponDates)
            if !couponDates.isEmpty {
                lines.append("派息观察日：")
                lines.append(contentsOf: couponDates)
            }
        }

        if position.rebateAnnualPct > 0 {
            lines.append("年化后端返息：\(percentText(position.rebateAnnualPct))")
        }
        if position.rebateAbsoluteBackPct > 0 {
            lines.append("绝对后端返息：\(percentText(position.rebateAbsoluteBackPct))")
        }
        if position.rebateAbsoluteFrontPct > 0 {
            lines.append("绝对前端返息：\(percentText(position.rebateAbsoluteFrontPct))")
        }
        if !position.accrualBasis.isEmpty {
            lines.append("计息规则：\(position.accrualBasis)")
        }
        if position.accrualSettleTplus > 0 {
            lines.append("计息结算T+：\(position.accrualSettleTplus)")
        }
        if position.absFeePct > 0 {
            lines.append("交易佣金：\(percentText(position.absFeePct))")
        }
        if position.annualFeePct > 0 {
            lines.append("年化费用：\(percentText(position.annualFeePct))")
        }
        if position.incomeDividendPct > 0 {
            lines.append("收益分红：\(percentText(position.incomeDividendPct))")
        }
        if !position.notes.isEmpty {
            // 备注是单行键值对，多行备注折成一行（解析器按行取值）
            lines.append("备注信息：\(position.notes.replacingOccurrences(of: "\n", with: " "))")
        }
        return lines.joined(separator: "\n")
    }

    /// 小数比例 → 百分数文本（0.156 → "15.6%"），4 位小数内去尾零；parse 侧去 % 后 ÷100 还原。
    private static func percentText(_ ratio: Double) -> String {
        var text = String(format: "%.4f", ratio * 100)
        if text.contains(".") {
            while text.hasSuffix("0") { text.removeLast() }
            if text.hasSuffix(".") { text.removeLast() }
        }
        return text + "%"
    }

    // MARK: - 解析主流程

    static func parse(_ text: String) -> Parsed {
        var result = Parsed(
            structureType: .snowball,
            productName: nil, contractNo: nil, broker: nil, underlyingCode: nil,
            notional: nil, tradeStartDate: nil, initialPrice: nil,
            knockOutDates: nil, knockOutBarriers: nil, knockOutCoupons: nil,
            knockOutEnhanceParticipation: nil, maturityCoupon: nil,
            knockInBarrier: nil, knockInObservation: nil, knockInStrike: nil,
            knockInParticipation: nil, marginRatio: nil, maxLossPct: nil,
            rebateAnnualPct: nil, rebateAbsoluteBackPct: nil, rebateAbsoluteFrontPct: nil,
            accrualBasis: nil, accrualSettleTplus: nil, absFeePct: nil,
            annualFeePct: nil, incomeDividendPct: nil,
            couponBarrier: nil, couponRate: nil, couponDates: nil,
            notes: nil, warnings: []
        )
        var currentListField: ListField?
        var listBuffers: [ListField: [String]] = [:]
        var unmapped: [String] = []

        // 与桌面端一致：结构类型先独立记录，列表/键值映射统一在 match 阶段处理
        for rawLine in text.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)

            // 区块分隔行：--- xxx ---（行首行尾都是至少两个连字符）
            if line.contains(Regex(/^-{2,}\s*.*\s*-{2,}$/)) {
                currentListField = nil
                continue
            }
            if line.isEmpty { continue }

            // key: value 行
            guard let (key, value) = splitKeyValue(line) else {
                // 列表数据行
                if let field = currentListField {
                    listBuffers[field, default: []].append(line)
                }
                continue
            }

            let normalized = stripListKey(key)

            // 先精确匹配键名，再按去括号归一化匹配
            if let target = simpleFields[key] ?? simpleFields[normalized] {
                applySimple(target, value: value, to: &result)
                currentListField = nil
                continue
            }
            // 列表标题（value 为空）
            if value.isEmpty, let listField = listFields[normalized] {
                currentListField = listField
                continue
            }
            if !unmapped.contains(normalized) {
                unmapped.append(normalized)
            }
        }

        // 回填列表字段（多行文本；纯数字 token 规范化为去尾零数值文本，与桌面端正则一致）
        for (field, buffer) in listBuffers {
            let tokens = buffer
                .map { $0.replacingOccurrences(of: "%", with: "").replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
                .map { token -> String in
                    if token.contains(Regex(/^-?\d+(\.\d+)?$/)), let number = Double(token) {
                        return jsNumberString(number)
                    }
                    return token
                }
            guard !tokens.isEmpty else { continue }
            let joined = tokens.joined(separator: "\n")
            switch field {
            case .knockOutDates: result.knockOutDates = joined
            case .knockOutBarriers: result.knockOutBarriers = joined
            case .knockOutCoupons: result.knockOutCoupons = joined
            case .couponDates: result.couponDates = joined
            }
        }

        // 结构类型文本回填产品名（若文本未提供产品名）
        if result.productName == nil {
            if let match = text.firstMatch(of: /结构类型[：:]\s*(.+)/) {
                result.productName = String(match.1).trimmingCharacters(in: .whitespaces)
            }
        }

        result.warnings = unmapped
        return result
    }

    // MARK: - 键值映射表

    private enum ListField: Hashable {
        case knockOutDates
        case knockOutBarriers
        case knockOutCoupons
        case couponDates
    }

    private enum SimpleTarget {
        case productName
        case contractNo
        case structureType
        case broker
        case notional
        case tradeStartDate
        case initialPrice
        case absFeePct
        case knockOutEnhanceParticipation
        case knockInBarrier
        case knockInObservation
        case knockInStrike
        case knockInParticipation
        case marginRatio
        case maxLossPct
        case rebateAnnualPct
        case rebateAbsoluteBackPct
        case rebateAbsoluteFrontPct
        case accrualBasis
        case accrualSettleTplus
        case annualFeePct
        case incomeDividendPct
        case maturityCoupon
        case couponBarrier
        case couponRate
        case notes
        case underlyingCode
    }

    private static let simpleFields: [String: SimpleTarget] = [
        "产品名称": .productName,
        "交易编号": .contractNo,
        "结构类型": .structureType,
        "交易对手方": .broker,
        "名义本金": .notional,
        "交易日期": .tradeStartDate,
        "期初价格": .initialPrice,
        "交易佣金": .absFeePct,
        "敲出增强参与率": .knockOutEnhanceParticipation,
        "敲入障碍价格": .knockInBarrier,
        "敲入观察方式": .knockInObservation,
        "敲入执行价格": .knockInStrike,
        "敲入参与率": .knockInParticipation,
        "保证金比例": .marginRatio,
        "最大亏损比例": .maxLossPct,
        "年化后端返息": .rebateAnnualPct,
        "绝对后端返息": .rebateAbsoluteBackPct,
        "绝对前端返息": .rebateAbsoluteFrontPct,
        "计息规则": .accrualBasis,
        "计息结算T+": .accrualSettleTplus,
        "计息结算T": .accrualSettleTplus,
        "年化费用": .annualFeePct,
        "收益分红": .incomeDividendPct,
        "红利票息": .maturityCoupon,
        "票息障碍价格": .couponBarrier,
        "派息障碍价格": .couponBarrier,
        "派息率": .couponRate,
        "备注信息": .notes,
        "挂钩标的": .underlyingCode,
    ]

    private static let listFields: [String: ListField] = [
        "敲出观察日": .knockOutDates,
        "敲出障碍价格": .knockOutBarriers,
        "敲出票息": .knockOutCoupons,
        "票息": .knockOutCoupons,
        "派息观察日": .couponDates,
    ]

    private static func applySimple(_ target: SimpleTarget, value: String, to result: inout Parsed) {
        switch target {
        case .productName:
            result.productName = value.trimmingCharacters(in: .whitespaces)
        case .contractNo:
            result.contractNo = value.trimmingCharacters(in: .whitespaces)
        case .structureType:
            result.structureType = deriveStructureType(value)
        case .broker:
            result.broker = value.trimmingCharacters(in: .whitespaces)
        case .notional:
            result.notional = toNumber(value)
        case .tradeStartDate:
            result.tradeStartDate = toDateStr(value)
        case .initialPrice:
            result.initialPrice = toNumber(value)
        case .absFeePct:
            result.absFeePct = toNumber(value)
        case .knockOutEnhanceParticipation:
            result.knockOutEnhanceParticipation = toNumber(value)
        case .knockInBarrier:
            result.knockInBarrier = toNumber(value)
        case .knockInObservation:
            result.knockInObservation = mapKnockInObservation(value)
        case .knockInStrike:
            result.knockInStrike = toNumber(value)
        case .knockInParticipation:
            result.knockInParticipation = toNumber(value)
        case .marginRatio:
            result.marginRatio = toNumber(value)
        case .maxLossPct:
            result.maxLossPct = toNumber(value)
        case .rebateAnnualPct:
            result.rebateAnnualPct = toNumber(value)
        case .rebateAbsoluteBackPct:
            result.rebateAbsoluteBackPct = toNumber(value)
        case .rebateAbsoluteFrontPct:
            result.rebateAbsoluteFrontPct = toNumber(value)
        case .accrualBasis:
            result.accrualBasis = mapAccrualBasis(value)
        case .accrualSettleTplus:
            result.accrualSettleTplus = toNumber(value)
        case .annualFeePct:
            result.annualFeePct = toNumber(value)
        case .incomeDividendPct:
            result.incomeDividendPct = toNumber(value)
        case .maturityCoupon:
            result.maturityCoupon = toNumber(value)
        case .couponBarrier:
            result.couponBarrier = toNumber(value)
        case .couponRate:
            result.couponRate = toNumber(value)
        case .notes:
            let trimmed = value.trimmingCharacters(in: .whitespaces)
            result.notes = trimmed == "-" ? "" : trimmed
        case .underlyingCode:
            result.underlyingCode = mapUnderlying(value)
        }
    }

    // MARK: - 值处理器

    private static func stripListKey(_ key: String) -> String {
        var text = key
        // 去掉末尾括号（含其中内容）
        if let regex = try? NSRegularExpression(pattern: "[（(].*?[)）]\\s*$") {
            let range = NSRange(text.startIndex..., in: text)
            text = regex.stringByReplacingMatches(in: text, range: range, withTemplate: "")
        }
        if text.hasSuffix("/派息率") {
            text = String(text.dropLast("/派息率".count))
        }
        return text.trimmingCharacters(in: .whitespaces)
    }

    private static func splitKeyValue(_ line: String) -> (String, String)? {
        // 与桌面端 /^(.+?)[：:]\s*(.*)$/ 一致：首个中英文冒号处切分
        for (offset, char) in line.enumerated() {
            if char == "：" || char == ":" {
                let keyIndex = line.index(line.startIndex, offsetBy: offset)
                let valueIndex = line.index(after: keyIndex)
                let key = String(line[line.startIndex..<keyIndex])
                let value = String(line[valueIndex...]).trimmingCharacters(in: .whitespaces)
                if !key.isEmpty {
                    return (key, value)
                }
                return nil
            }
        }
        return nil
    }

    private static func toNumber(_ raw: String) -> Double? {
        let cleaned = raw
            .replacingOccurrences(of: ",", with: "")
            .replacingOccurrences(of: "%", with: "")
            .trimmingCharacters(in: .whitespaces)
        guard !cleaned.isEmpty else { return nil }
        let value = Double(cleaned)
        return value.flatMap { $0.isFinite ? $0 : nil }
    }

    private static func toDateStr(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        return trimmed.contains(Regex(/^\d{4}-\d{2}-\d{2}$/)) ? trimmed : nil
    }

    /// 判定依据是产品家族：凤凰/DCN → 凤凰，气囊 → airbag 按 snowball 兜底记录但保持家族判断
    private static func deriveStructureType(_ raw: String) -> StructureType {
        let value = raw.trimmingCharacters(in: .whitespaces)
        if value.contains("凤凰") || value.contains("DCN") { return .phoenix }
        return .snowball
    }

    private static func mapKnockInObservation(_ raw: String) -> String {
        let value = raw.trimmingCharacters(in: .whitespaces)
        if value.contains("每日") || value.contains("每天") { return "daily" }
        if value.contains("到期") || value.contains("期末") || value.contains("仅到期") { return "maturity" }
        return value
    }

    private static func mapAccrualBasis(_ raw: String) -> String {
        let value = raw.trimmingCharacters(in: .whitespaces)
        if value.contains("双") { return "both" }
        if value.contains("单") { return "one" }
        return value
    }

    private static func mapUnderlying(_ raw: String) -> String {
        let value = raw.trimmingCharacters(in: .whitespaces)
        let indexNames: [String: String] = [
            "中证500": "000905.SH",
            "沪深300": "000300.SH",
            "中证1000": "000852.SH",
            "上证50": "000016.SH",
        ]
        return indexNames[value] ?? value
    }

    /// JS String(Number(token))：100.0000 → "100"
    private static func jsNumberString(_ number: Double) -> String {
        if number == number.rounded() && abs(number) < 1e15 {
            return String(Int64(number))
        }
        return String(number)
    }
}
