import Foundation

/// 远程鉴权服务配置。
/// 2026-10-16 起 6001 主地址已下线，仅使用 6006；AuthClient 的主备并发竞速逻辑保留，
/// 日后恢复主备时把第二个地址加回 endpoints 即可。
enum APIConfig {
    static let authBaseURL = URL(string: "http://8.159.158.153:6006")!

    static var endpoints: [URL] {
        [authBaseURL]
    }
}

/// 登录/健康探测客户端。主备地址并发竞速，规则与桌面端 firstLoginResult 一致：
/// 任一路 200 立即采用；任一路 4xx（确定性结果，如密码错误）立即采用；
/// 全部失败时择优（有 HTTP 响应者优先于网络失败，主地址优先于备用）。
struct AuthClient {
    struct Outcome {
        var ok: Bool
        var status: Int      // 0 = 网络失败（无 HTTP 响应）
        var token: String?
        var message: String? // 服务端 message / detail
        var sourceURL: URL?
    }

    enum AuthError: Error {
        case badURL
    }

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// 登录：并发请求主备两端点。
    func login(username: String, password: String) async -> Outcome {
        let endpoints = APIConfig.endpoints
        guard let primary = endpoints.first else {
            return Outcome(ok: false, status: 0, token: nil, message: "未配置鉴权地址", sourceURL: nil)
        }
        if endpoints.count == 1 {
            return await postLogin(primary, username: username, password: password)
        }
        let fallback = endpoints[1]

        async let primaryOutcome = postLogin(primary, username: username, password: password)
        async let fallbackOutcome = postLogin(fallback, username: username, password: password)

        let first = await primaryOutcome
        if first.ok { return first }
        if (400..<500).contains(first.status) { return first }

        let second = await fallbackOutcome
        if second.ok { return second }
        // 择优：有 HTTP 响应的优先于网络失败
        return first.status > 0 ? first : second
    }

    /// 健康探测：任一端点返回任意 HTTP 响应即视为就绪（5 秒超时）。
    func ping() async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            for endpoint in APIConfig.endpoints {
                group.addTask { await Self.pingOnce(endpoint, session: self.session) }
            }
            var anyReachable = false
            for await reachable in group where reachable {
                anyReachable = true
            }
            return anyReachable
        }
    }

    // MARK: - Private

    private func postLogin(_ baseURL: URL, username: String, password: String) async -> Outcome {
        guard let url = URL(string: "/api/v1/auth/login/", relativeTo: baseURL) else {
            return Outcome(ok: false, status: 0, token: nil, message: nil, sourceURL: baseURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload = ["username": username, "password": password]
        request.httpBody = try? JSONEncoder().encode(payload)

        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let body = try? JSONDecoder().decode(LoginResponse.self, from: data)
            return Outcome(
                ok: status == 200,
                status: status,
                token: body?.resolvedToken,
                message: body?.resolvedMessage,
                sourceURL: baseURL
            )
        } catch {
            return Outcome(ok: false, status: 0, token: nil, message: nil, sourceURL: baseURL)
        }
    }

    private static func pingOnce(_ baseURL: URL, session: URLSession) async -> Bool {
        guard let url = URL(string: "/api/v1/auth/login/", relativeTo: baseURL) else { return false }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 5
        do {
            // 收到任意 HTTP 响应即视为可达（与桌面端 ping 语义一致，不校验状态码）
            _ = try await session.data(for: request)
            return true
        } catch {
            return false
        }
    }
}

/// 登录响应体：兼容 token 在 data.token 或 data.data.token 两种解包（与桌面端一致）。
private struct LoginResponse: Decodable {
    struct Nested: Decodable {
        var token: String?
    }

    var token: String?
    var data: NestedOrString?
    var message: FlexibleString?
    var detail: FlexibleString?

    var resolvedToken: String? {
        token ?? data?.token
    }

    var resolvedMessage: String? {
        message?.value ?? detail?.value
    }
}

/// data 字段可能是对象（含 token）或字符串。
private struct NestedOrString: Decodable {
    var token: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let nested = try? container.decode(LoginResponse.Nested.self) {
            token = nested.token
        } else if let _ = try? container.decode(String.self) {
            token = nil
        } else {
            token = nil
        }
    }
}

/// message / detail 可能是字符串；容错其它类型（丢弃）。
struct FlexibleString: Decodable {
    var value: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        value = try? container.decode(String.self)
    }
}
