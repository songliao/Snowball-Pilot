#if DEBUG
import Darwin
import Foundation
import Dispatch

/// 主线程卡死看门狗（仅 DEBUG）：看门狗线程每 0.5s 向主线程派发心跳，
/// 连续 ~3s 未响应即挂起主线程、读寄存器沿帧链走栈，把调用栈追加写入
/// Documents/hang_log.txt，供 devicectl 拉取定位（真机偶发卡死、锁屏后
/// Instruments 无法采样的场景）。定位完成后删除。
nonisolated enum MainThreadHangWatchdog {
    /// arm64 线程状态 flavor（SDK 未导出该 Swift 常量名，按 mach/thread_status.h 取值 6）
    private static let ARM_THREAD_STATE64: thread_state_flavor_t = 6
    private static let lock = NSLock()
    private nonisolated(unsafe) static var mainThread: thread_act_t = 0
    private nonisolated(unsafe) static var started = false
    private nonisolated(unsafe) static var pingPending = false

    static func start() {
        lock.lock()
        defer { lock.unlock() }
        guard !started else { return }
        started = true

        DispatchQueue.main.async {
            mainThread = mach_thread_self()
        }

        let thread = Thread {
            var misses = 0
            while true {
                Thread.sleep(forTimeInterval: 0.5)
                lock.lock()
                let responded = pingPending
                pingPending = false
                lock.unlock()
                misses = responded ? 0 : misses + 1
                if misses >= 6 {
                    logMainThreadStack()
                    misses = 0
                }
                DispatchQueue.main.async {
                    lock.lock()
                    pingPending = true
                    lock.unlock()
                }
            }
        }
        thread.name = "main-hang-watchdog"
        thread.stackSize = 1 << 20
        thread.start()
    }

    /// arm64 帧链走栈：fp 链 [fp]=上一帧 fp, [fp+8]=lr。
    private static func logMainThreadStack() {
        guard mainThread != 0 else { return }
        guard thread_suspend(mainThread) == KERN_SUCCESS else { return }
        defer { thread_resume(mainThread) }

        var state = arm_thread_state64_t()
        var count = mach_msg_type_number_t(MemoryLayout<arm_thread_state64_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &state) { st in
            st.withMemoryRebound(to: natural_t.self, capacity: Int(count)) { p in
                thread_get_state(mainThread, ARM_THREAD_STATE64, p, &count)
            }
        }
        guard kr == KERN_SUCCESS else {
            append("==== hang @ \(Date()) thread_get_state kr=\(kr) ====")
            return
        }

        // 去掉 PAC 签名位（arm64e 系统帧的 pc/lr 带签名）
        func strip(_ v: UInt64) -> UInt64 { v & 0x0000_007F_FFFF_FFFF }
        var lines: [String] = ["==== hang @ \(Date()) ===="]
        var pc = Int(Int64(bitPattern: strip(state.__pc)))
        var fp = Int(Int64(bitPattern: strip(state.__fp)))
        var steps = 0
        while fp != 0, steps < 128 {
            lines.append(symbolicate(pc))
            guard let frame = UnsafeRawPointer(bitPattern: fp) else { break }
            let lr = Int(Int64(bitPattern: strip(UInt64(bitPattern: frame.load(fromByteOffset: 8, as: Int64.self)))))
            let savedFP = Int(Int64(bitPattern: strip(UInt64(bitPattern: frame.load(as: Int64.self)))))
            pc = lr
            fp = savedFP
            steps += 1
        }
        append(lines.joined(separator: "\n"))
    }

    private static func symbolicate(_ address: Int) -> String {
        let infoPtr = UnsafeMutablePointer<Dl_info>.allocate(capacity: 1)
        defer { infoPtr.deallocate() }
        guard let pointer = UnsafeRawPointer(bitPattern: address),
              dladdr(pointer, infoPtr) != 0
        else { return "0x" + String(address, radix: 16) }
        let info = infoPtr.pointee
        let image = cString(info.dli_fname)
        let name = (image as NSString).lastPathComponent
        let base: Int
        if let fbase = info.dli_fbase { base = Int(bitPattern: fbase) } else { base = 0 }
        let offset = address - base
        let symbol = cString(info.dli_sname)
        return symbol.isEmpty
            ? "\(name) +0x\(String(offset, radix: 16))"
            : "\(symbol)  (\(name))"
    }

    private static func cString(_ pointer: UnsafePointer<CChar>?) -> String {
        guard let pointer else { return "?" }
        return String(cString: pointer)
    }

    private static func append(_ text: String) {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("hang_log.txt")
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { handle.closeFile() }
            handle.seekToEndOfFile()
            _ = try? handle.write(contentsOf: Data(text.utf8))
        } else {
            _ = try? Data(text.utf8).write(to: url, options: .atomic)
        }
    }
}
#endif
