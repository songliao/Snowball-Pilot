import Foundation

/// 持仓 CSV 导入/导出——列序与解析规则和桌面端 electron/database/positions.ts 完全一致，
/// 保证桌面端与 iOS 端的 CSV 文件可互相导入。
enum CSV {
    // MARK: - RFC4180

    /// 最小 RFC4180 解析器：支持引号包裹、双引号转义、CRLF；过滤完全空白行。
    static func parse(_ rawText: String) -> [[String]] {
        var text = rawText
        if let first = text.unicodeScalars.first, first == "\u{FEFF}" {
            text.unicodeScalars.removeFirst()
        }
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var inQuotes = false
        var index = text.startIndex
        while index < text.endIndex {
            let char = text[index]
            if inQuotes {
                if char == "\"" {
                    let next = text.index(after: index)
                    if next < text.endIndex, text[next] == "\"" {
                        field.append("\"")
                        index = text.index(after: next)
                        continue
                    }
                    inQuotes = false
                    index = next
                    continue
                }
                field.append(char)
                index = text.index(after: index)
                continue
            }
            switch char {
            case "\"":
                inQuotes = true
                index = text.index(after: index)
            case ",":
                row.append(field)
                field = ""
                index = text.index(after: index)
            case "\r", "\n", "\r\n":
                // 注意：Swift 的 Character 是字素簇，CRLF 是单个 Character，需一并匹配
                row.append(field)
                rows.append(row)
                row = []
                field = ""
                index = text.index(after: index)
            default:
                field.append(char)
                index = text.index(after: index)
            }
        }
        if !field.isEmpty || !row.isEmpty {
            row.append(field)
            rows.append(row)
        }
        return rows.filter { record in record.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty } }
    }

    /// 与桌面端 csvEscape 一致：含引号/逗号/换行时加引号并转义内部引号。
    static func escape(_ value: String) -> String {
        if value.contains("\"") || value.contains(",") || value.contains("\r") || value.contains("\n") {
            return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return value
    }

    /// 导出文本：BOM + CRLF 行（Excel 直接打开可识别 UTF-8 中文）。records 为原始值，统一在此转义。
    static func buildText(records: [[String]]) -> String {
        let body = records
            .map { $0.map(escape).joined(separator: ",") }
            .joined(separator: "\r\n")
        return "\u{FEFF}" + body + "\r\n"
    }

    // MARK: - Position 映射

    /// 持仓 → CSV 行（首行为表头）。数值格式与 JS String(number) 一致（整数不带小数点）。
    static func exportText(positions: [Position]) -> String {
        var records: [[String]] = [Schema.csvColumns]
        for position in positions {
            records.append(Schema.csvColumns.map { columnValue($0, of: position) })
        }
        return buildText(records: records)
    }

    private static func columnValue(_ column: String, of p: Position) -> String {
        switch column {
        case "structure_type": return p.structureType.rawValue
        case "product_name": return p.productName
        case "broker": return p.broker
        case "contract_no": return p.contractNo
        case "trade_start_date": return p.tradeStartDate
        case "underlying_code": return p.underlyingCode
        case "notional": return jsNumber(p.notional)
        case "initial_price": return jsNumber(p.initialPrice)
        case "knock_in_barrier": return jsNumber(p.knockInBarrier)
        case "knock_in_strike": return jsNumber(p.knockInStrike)
        case "margin_ratio": return jsNumber(p.marginRatio)
        case "knock_out_dates": return p.knockOutDates
        case "knock_out_barriers": return p.knockOutBarriers
        case "knock_in_observation": return p.knockInObservation
        case "knock_in_participation": return jsNumber(p.knockInParticipation)
        case "max_loss_pct": return jsNumber(p.maxLossPct)
        case "rebate_annual_pct": return jsNumber(p.rebateAnnualPct)
        case "rebate_absolute_back_pct": return jsNumber(p.rebateAbsoluteBackPct)
        case "rebate_absolute_front_pct": return jsNumber(p.rebateAbsoluteFrontPct)
        case "accrual_basis": return p.accrualBasis
        case "accrual_settle_tplus": return jsNumber(Double(p.accrualSettleTplus))
        case "abs_fee_pct": return jsNumber(p.absFeePct)
        case "annual_fee_pct": return jsNumber(p.annualFeePct)
        case "income_dividend_pct": return jsNumber(p.incomeDividendPct)
        case "notes": return p.notes
        case "status": return p.status.rawValue
        case "is_ki": return p.isKi ? "1" : "0"
        case "knock_in_date": return p.knockInDate
        case "termination_date": return p.terminationDate
        case "termination_payoff": return jsNumber(p.terminationPayoff)
        case "knock_out_coupons": return p.knockOutCoupons
        case "knock_out_enhance_participation": return jsNumber(p.knockOutEnhanceParticipation)
        case "maturity_coupon": return jsNumber(p.maturityCoupon)
        case "coupon_barrier": return jsNumber(p.couponBarrier)
        case "coupon_dates": return p.couponDates
        case "coupon_rate": return jsNumber(p.couponRate)
        case "coupon_received": return p.couponReceived
        case "coupon_payment_dates": return p.couponPaymentDates
        default: return ""
        }
    }

    /// JS Number → String 语义：整数值不带小数点（100.0 → "100"）。
    static func jsNumber(_ value: Double) -> String {
        if value == value.rounded() && abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }

    /// CSV 记录 → 持仓（逐行容错）。返回解析成功的持仓与失败行数（与桌面端导入语义一致）。
    static func importPositions(from text: String) -> (positions: [Position], failed: Int) {
        let rows = parse(text)
        guard rows.count >= 2 else { return ([], rows.isEmpty ? 0 : 1) }

        let header = rows[0].map { $0.trimmingCharacters(in: .whitespaces) }
        var positions: [Position] = []
        var failed = 0

        for rowIndex in 1..<rows.count {
            let cells = rows[rowIndex]
            var record: [String: String] = [:]
            for (index, column) in header.enumerated() where index < cells.count {
                record[column] = cells[index]
            }

            let structureRaw = (record["structure_type"] ?? "").trimmingCharacters(in: .whitespaces)
            guard let structureType = StructureType(rawValue: structureRaw) else {
                failed += 1
                continue
            }
            var position = Position(structureType: structureType)
            for column in Schema.columns(for: structureType) {
                let raw = (record[column] ?? "").trimmingCharacters(in: .whitespaces)
                if raw.isEmpty { continue } // 空值走模型默认值（与桌面端 colValue 兜底一致）
                if Schema.numericCSVColumns.contains(column) {
                    let value = Double(raw) ?? 0 // Number(非数字) → NaN → || 0
                    position.setNumericColumn(column, value)
                } else {
                    position.setTextColumn(column, raw)
                }
            }
            if (record["is_ki"] ?? "").trimmingCharacters(in: .whitespaces) == "1" {
                position.isKi = true
            }
            positions.append(position)
        }
        return (positions, failed)
    }
}

extension Position {
    /// CSV 导入的数值列写入（列名与模型字段对应，含整数字段）。
    mutating func setNumericColumn(_ column: String, _ value: Double) {
        switch column {
        case "notional": notional = value
        case "initial_price": initialPrice = value
        case "knock_in_barrier": knockInBarrier = value
        case "knock_in_strike": knockInStrike = value
        case "margin_ratio": marginRatio = value
        case "knock_in_participation": knockInParticipation = value
        case "max_loss_pct": maxLossPct = value
        case "rebate_annual_pct": rebateAnnualPct = value
        case "rebate_absolute_back_pct": rebateAbsoluteBackPct = value
        case "rebate_absolute_front_pct": rebateAbsoluteFrontPct = value
        case "abs_fee_pct": absFeePct = value
        case "annual_fee_pct": annualFeePct = value
        case "income_dividend_pct": incomeDividendPct = value
        case "termination_payoff": terminationPayoff = value
        case "knock_out_enhance_participation": knockOutEnhanceParticipation = value
        case "maturity_coupon": maturityCoupon = value
        case "coupon_barrier": couponBarrier = value
        case "coupon_rate": couponRate = value
        case "accrual_settle_tplus": accrualSettleTplus = Int(value)
        default: break
        }
    }

    /// CSV 导入的文本列写入。
    mutating func setTextColumn(_ column: String, _ value: String) {
        switch column {
        case "product_name": productName = value
        case "broker": broker = value
        case "contract_no": contractNo = value
        case "trade_start_date": tradeStartDate = value
        case "underlying_code": underlyingCode = value
        case "knock_out_dates": knockOutDates = value
        case "knock_out_barriers": knockOutBarriers = value
        case "knock_in_observation": knockInObservation = value
        case "accrual_basis": accrualBasis = value
        case "notes": notes = value
        case "status": status = PositionStatus(raw: value)
        case "knock_in_date": knockInDate = value
        case "termination_date": terminationDate = value
        case "knock_out_coupons": knockOutCoupons = value
        case "coupon_dates": couponDates = value
        case "coupon_received": couponReceived = value
        case "coupon_payment_dates": couponPaymentDates = value
        default: break
        }
    }
}
