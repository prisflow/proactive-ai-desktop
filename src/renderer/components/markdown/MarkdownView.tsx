import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { MermaidBlock } from './MermaidBlock'
import { CodeBlock } from './CodeBlock'

export const MarkdownView = memo(function MarkdownView({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          pre(props) {
            const { children, ...rest } = props
            // react-markdown wraps fenced code blocks in <pre><code/></pre>.
            // For ```mermaid fences we render a custom block and must NOT keep the <pre>,
            // otherwise global `.markdown pre { ... }` styles create an extra container.
            const onlyChild = Array.isArray(children) ? children[0] : children
            if (
              onlyChild &&
              typeof onlyChild === 'object' &&
              'props' in onlyChild &&
              (onlyChild as { props?: { className?: string } }).props?.className?.includes(
                'language-mermaid'
              )
            ) {
              return <>{children}</>
            }
            return <pre {...rest}>{children}</pre>
          },
          code(props) {
            const { children, className, ...rest } = props
            const match = /language-([a-zA-Z0-9_-]+)/.exec(className || '')
            const lang = match?.[1]
            const code = String(children ?? '').replace(/\n$/, '')

            if (lang === 'mermaid') {
              return <MermaidBlock chart={code} />
            }

            const isInline = !className && !code.includes('\n')
            if (isInline) {
              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              )
            }

            return <CodeBlock code={code} language={lang} />
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})

