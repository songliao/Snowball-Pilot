import SwiftUI

@main
struct SnowballPilotApp: App {
    @State private var appModel = AppModel()

    init() {
        #if DEBUG
        MainThreadHangWatchdog.start()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appModel)
                .environment(appModel.theme)
                .environment(appModel.services)
                .preferredColorScheme(appModel.theme.colorScheme)
                .tint(.accentColor)
        }
    }
}
