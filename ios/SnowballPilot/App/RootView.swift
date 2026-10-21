import SwiftUI

/// 根视图：免登录，启动即进主界面（首页为开机画面）；仅数据库打开失败时显示错误。
struct RootView: View {
    @Environment(AppModel.self) private var appModel

    var body: some View {
        if ProcessInfo.processInfo.arguments.contains("-screen") {
            NavigationStack { ContractCheckView() }
                .environment(appModel.services)
                .task { appModel.bootstrap() }
        } else if appModel.ready {
            MainTabView()
        } else if let error = appModel.loadError {
            ContentUnavailableView("打开失败",
                                   systemImage: "exclamationmark.triangle",
                                   description: Text(error))
        } else {
            ProgressView("正在打开…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .task { appModel.bootstrap() }
        }
    }
}
