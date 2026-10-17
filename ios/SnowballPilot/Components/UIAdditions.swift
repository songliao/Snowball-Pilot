import SwiftUI

/// 卡片表面：统一系统灰卡。
/// 说明：iOS 26 的 Liquid Glass（glassEffect / GlassEffectContainer）在真机上伴随导航
/// 返回动画重布局时，会触发「动态颜色解析 ↔ trait 集合修改」的主线程死循环
/// （Time Profiler 实锤卡死在 UIKitPlatformColorDefinition.resolve，CPU 满负荷），
/// 故暂时停用玻璃效果；系统修复后把两个方法换回 glassEffect 实现即可。
extension View {
    func glassCard(cornerRadius: CGFloat = 14) -> some View {
        background(
            RoundedRectangle(cornerRadius: cornerRadius)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }

    /// 多个玻璃元素共存时包裹，让形状融合过渡；停用玻璃后原样返回。
    func glassContainer(spacing: CGFloat, @ViewBuilder _ content: () -> some View) -> some View {
        content()
    }
}
