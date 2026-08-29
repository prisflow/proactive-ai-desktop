import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
// cva用于json定义样式与props对接，作为样式生成器
import { cva, type VariantProps } from "class-variance-authority"
// cn作用于cva外层，用于合并与清理冲突规则
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-focus-ring)] focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-blue-600 text-white hover:bg-blue-500",
        secondary:
          "bg-[var(--app-button-secondary-bg)] text-[var(--app-button-secondary-fg)] hover:bg-[var(--app-button-secondary-hover)]",
        ghost: "hover:bg-[var(--app-hover-strong)]",
        outline:
          "border border-[color:var(--app-border-strong)] bg-transparent hover:bg-[var(--app-hover)]",
      },
      size: {
        default: "h-11 px-6 py-3",
        sm: "h-9 px-3",
        lg: "h-12 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  // 继承原生按钮
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    // 绑定CVA
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

// 转发组件引用，用于上层组件测量物理尺寸和控制焦点等等
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    // 用asChild控制渲染HTML标签还是复制合并到子元素上
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
