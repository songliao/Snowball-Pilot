import SwiftUI

/// 登录页：账号密码 → 主/备鉴权服务并发竞速（与桌面端一致）。
/// 视觉：大留白品牌式布局——LOGO 光晕 + 品牌色渐变 + 扁平化大输入框。
struct LoginView: View {
    @Environment(AppModel.self) private var appModel

    @State private var username = ""
    @State private var password = ""
    @State private var loading = false
    @State private var errorMessage = ""
    @State private var serverReachable: Bool?

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 32)
            hero
            Spacer(minLength: 40)
            formSection
            Spacer(minLength: 28)
            footer
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            // 全屏品牌色氛围：顶部线性渐变 + LOGO 背后光晕
            ZStack {
                Color(.systemBackground)
                    .ignoresSafeArea()
                LinearGradient(
                    colors: [Color.accentColor.opacity(0.18), Color.accentColor.opacity(0.04), .clear],
                    startPoint: .top,
                    endPoint: UnitPoint(x: 0.5, y: 0.62)
                )
                .ignoresSafeArea()
                RadialGradient(
                    colors: [Color.accentColor.opacity(0.22), .clear],
                    center: .center,
                    startRadius: 10,
                    endRadius: 260
                )
                .frame(width: 520, height: 520)
                .blur(radius: 24)
                .offset(y: -170)
            }
            .allowsHitTesting(false)
        }
        .sensoryFeedback(.error, trigger: errorMessage)
        .task { await pingServer() }
    }

    // MARK: - 品牌区

    private var hero: some View {
        VStack(spacing: 18) {
            Image(.appLogo)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: 132, height: 132)
                .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
                .shadow(color: .black.opacity(0.18), radius: 16, y: 8)
                .accessibilityLabel("Snowball Pilot")
                #if DEBUG
                .onTapGesture {
                    logoTaps += 1
                    if logoTaps >= 5 {
                        logoTaps = 0
                        appModel.demoLogin()
                    }
                }
                #endif

            VStack(spacing: 6) {
                Text("Snowball Pilot")
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .tracking(0.5)
                Text("场外雪球 / 凤凰合约持仓管理")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .tracking(1)
            }
        }
        .frame(maxWidth: .infinity)
    }

    #if DEBUG
    @State private var logoTaps = 0
    #endif

    // MARK: - 登录表单

    private var formSection: some View {
        VStack(spacing: 16) {
            // 分组输入框：仅外框线，行间细分隔线
            VStack(spacing: 0) {
                fieldRow(icon: "person.crop.circle") {
                    TextField("用户名", text: $username)
                        .textContentType(.username)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                }
                Divider().padding(.leading, 56)
                fieldRow(icon: "lock.circle") {
                    SecureField("密码", text: $password)
                        .textContentType(.password)
                        .onSubmit { Task { await submit() } }
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color(.systemBackground))
                    .shadow(color: .black.opacity(0.05), radius: 3, y: 1)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color(.separator).opacity(0.35), lineWidth: 1)
            )
            .frame(maxWidth: 440)

            VStack(spacing: 12) {
                if !errorMessage.isEmpty {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                loginButton
                    .disabled(disabled)

                serverStatus
            }
            .frame(maxWidth: 440)
            .animation(.snappy, value: errorMessage)
        }
    }

    private func fieldRow<Content: View>(icon: String, @ViewBuilder _ field: () -> Content) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(.secondary)
                .frame(width: 22)
            field()
                .font(.body)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
    }

    @ViewBuilder
    private var loginButton: some View {
        let label = HStack(spacing: 8) {
            if loading {
                ProgressView()
                    .controlSize(.small)
                    .tint(.white)
            }
            Text(loading ? "登录中…" : "登录")
                .font(.system(size: 17, weight: .semibold))
        }
        .frame(maxWidth: .infinity)
        .frame(height: 52)

        if #available(iOS 26.0, *) {
            Button { Task { await submit() } } label: { label }
                .buttonStyle(.glassProminent)
        } else {
            Button { Task { await submit() } } label: { label }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 14))
        }
    }

    private var footer: some View {
        Text("Snowball Pilot \(appVersion)")
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .padding(.bottom, 24)
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    private var disabled: Bool {
        loading || username.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty
    }

    private var serverStatus: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
            Text(statusText)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private var statusColor: Color {
        switch serverReachable {
        case .some(true): .green
        case .some(false): .red
        case nil: .gray
        }
    }

    private var statusText: String {
        switch serverReachable {
        case .some(true): "鉴权服务可用"
        case .some(false): "鉴权服务不可达"
        case nil: "正在检测鉴权服务…"
        }
    }

    private func submit() async {
        guard !disabled else { return }
        loading = true
        errorMessage = ""
        if let error = await appModel.login(
            username: username.trimmingCharacters(in: .whitespaces),
            password: password
        ) {
            errorMessage = error
        }
        loading = false
    }

    private func pingServer() async {
        serverReachable = await AuthClient().ping()
    }
}
