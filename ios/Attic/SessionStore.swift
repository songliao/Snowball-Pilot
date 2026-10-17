import Foundation
import Security

/// 登录态持久化：token 存 Keychain，用户名/登录时间存 UserDefaults。
/// 与桌面端语义一致（桌面端 safeStorage 加密存 localStorage，30 天会话本地判定）。
nonisolated enum SessionStore {
    static let sessionTTL: TimeInterval = 30 * 24 * 3600

    private static let service = "com.snowball.pilot.ios.session"
    private static let tokenAccount = "auth-token"
    private static let usernameKey = "session-username"
    private static let loginTimeKey = "session-login-time"

    static func save(_ session: UserSession) {
        let defaults = UserDefaults.standard
        defaults.set(session.username, forKey: usernameKey)
        defaults.set(session.loginTime, forKey: loginTimeKey)
        _ = keychainSet(Data(session.token.utf8), account: tokenAccount)
    }

    static func restore() -> UserSession? {
        let defaults = UserDefaults.standard
        guard let username = defaults.string(forKey: usernameKey),
              let loginTime = readLoginTime(defaults),
              let tokenData = keychainGet(account: tokenAccount),
              let token = String(data: tokenData, encoding: .utf8)
        else { return nil }
        let session = UserSession(username: username, token: token, loginTime: loginTime)
        return session.isExpired ? nil : session
    }

    /// 兼容两种历史存储：Date（正确）与 timeIntervalSince1970 数字（旧版误存，导致恢复永远失败）。
    private static func readLoginTime(_ defaults: UserDefaults) -> Date? {
        if let date = defaults.object(forKey: loginTimeKey) as? Date { return date }
        if let interval = defaults.object(forKey: loginTimeKey) as? TimeInterval {
            return Date(timeIntervalSince1970: interval)
        }
        return nil
    }

    static func clear() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: usernameKey)
        defaults.removeObject(forKey: loginTimeKey)
        keychainDelete(account: tokenAccount)
    }

    // MARK: - Keychain

    private static func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func keychainSet(_ data: Data, account: String) -> Bool {
        keychainDelete(account: account)
        var attributes = baseQuery(account: account)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
    }

    private static func keychainGet(account: String) -> Data? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    private static func keychainDelete(account: String) {
        SecItemDelete(baseQuery(account: account) as CFDictionary)
    }
}
