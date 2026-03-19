'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Textarea from 'react-textarea-autosize'
import { useRouter } from 'next/navigation'

import { UseChatHelpers } from '@ai-sdk/react'
import { ArrowUp, ChevronDown, MessageCirclePlus, Square } from 'lucide-react'
import { toast } from 'sonner'

import { UploadedFile } from '@/lib/types'
import type { UIDataTypes, UIMessage, UITools } from '@/lib/types/ai'
import { cn } from '@/lib/utils'

import { useArtifact } from './artifact/artifact-context'
import { Button } from './ui/button'
import { IconBlinkingLogo } from './ui/icons'
import { ActionButtons } from './action-buttons'
import { FileUploadButton } from './file-upload-button'
import { ModelTypeSelector } from './model-type-selector'
import { SearchModeSelector } from './search-mode-selector'
import { UploadedFileList } from './uploaded-file-list'

const INPUT_UPDATE_DELAY_MS = 10

interface ChatPanelProps {
  chatId: string
  input: string
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  status: UseChatHelpers<UIMessage<unknown, UIDataTypes, UITools>>['status']
  messages: UIMessage[]
  setMessages: (messages: UIMessage[]) => void
  query?: string
  stop: () => void
  append: (message: any) => void
  showScrollToBottomButton: boolean
  scrollContainerRef: React.RefObject<HTMLDivElement>
  uploadedFiles: UploadedFile[]
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>
  onNewChat?: () => void
  isGuest?: boolean
}

export function ChatPanel({
  chatId,
  input,
  handleInputChange,
  handleSubmit,
  status,
  messages,
  setMessages,
  query,
  stop,
  append,
  showScrollToBottomButton,
  uploadedFiles,
  setUploadedFiles,
  scrollContainerRef,
  onNewChat,
  isGuest = false
}: ChatPanelProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isFirstRender = useRef(true)
  const [isComposing, setIsComposing] = useState(false)
  const [enterDisabled, setEnterDisabled] = useState(false)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const { close: closeArtifact } = useArtifact()
  const isLoading = status === 'submitted' || status === 'streaming'

  const handleCompositionStart = () => setIsComposing(true)
  const handleCompositionEnd = () => {
    setIsComposing(false)
    setEnterDisabled(true)
    setTimeout(() => setEnterDisabled(false), 300)
  }

  const handleNewChat = () => {
    setMessages([])
    closeArtifact()
    setIsInputFocused(false)
    inputRef.current?.blur()
    onNewChat?.()
    router.push('/')
  }

  const isToolInvocationInProgress = () => {
    if (!messages.length) return false
    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role !== 'assistant' || !lastMessage.parts) return false
    const lastPart = lastMessage.parts[lastMessage.parts.length - 1]
    return (
      (lastPart?.type === 'tool-search' ||
        lastPart?.type === 'tool-fetch' ||
        lastPart?.type === 'tool-askQuestion') &&
      ((lastPart as any)?.state === 'input-streaming' ||
        (lastPart as any)?.state === 'input-available')
    )
  }

  useEffect(() => {
    if (isFirstRender.current && query && query.trim().length > 0) {
      append({ role: 'user', content: query })
      isFirstRender.current = false
    }
  }, [query, append])

  const handleFileRemove = useCallback(
    (index: number) => {
      setUploadedFiles(prev => prev.filter((_, i) => i !== index))
    },
    [setUploadedFiles]
  )

  const handleScrollToBottom = () => {
    scrollContainerRef.current?.scrollTo({
      top: scrollContainerRef.current.scrollHeight,
      behavior: 'smooth'
    })
  }

  return (
    <div className={cn('w-full bg-background group/form-container shrink-0', messages.length > 0 ? 'sticky bottom-0 px-2 pb-4' : 'px-6')}>
      {messages.length === 0 && (
        <div className="mb-10 flex flex-col items-center gap-4">
          <IconBlinkingLogo className="size-12" />
          <h1 className="text-2xl font-medium text-foreground">What would you like to know?</h1>
        </div>
      )}
      
      {uploadedFiles.length > 0 && (
        <UploadedFileList files={uploadedFiles} onRemove={handleFileRemove} />
      )}

      <form
        onSubmit={e => {
          handleSubmit(e)
          setIsInputFocused(false)
          inputRef.current?.blur()
        }}
        className="max-w-full md:max-w-3xl w-full mx-auto relative"
      >
        {showScrollToBottomButton && messages.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="absolute -top-10 right-4 z-20 size-8 rounded-full shadow-md"
            onClick={handleScrollToBottom}
          >
            <ChevronDown size={16} />
          </Button>
        )}

        <div className={cn('relative flex flex-col w-full gap-2 bg-muted rounded-3xl border border-input transition-shadow', isInputFocused && 'ring-1 ring-ring/20')}>
          <Textarea
            ref={inputRef}
            name="input"
            rows={2}
            maxRows={5}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setIsInputFocused(false)}
            placeholder="Ask anything..."
            value={input}
            disabled={isLoading || isToolInvocationInProgress()}
            className="resize-none w-full min-h-12 bg-transparent border-0 p-4 text-sm focus-visible:outline-none"
            onChange={handleInputChange}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !isComposing && !enterDisabled) {
                if (input.trim().length === 0) {
                  e.preventDefault()
                  return
                }
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />

          <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-2">
              <FileUploadButton
                onFileSelect={async files => {
                  const newFiles: UploadedFile[] = files.map(file => ({ file, status: 'uploading' }))
                  setUploadedFiles(prev => [...prev, ...newFiles])
                  await Promise.all(
                    newFiles.map(async uf => {
                      const formData = new FormData()
                      formData.append('file', uf.file)
                      formData.append('chatId', chatId)
                      try {
                        const res = await fetch('/api/upload', { method: 'POST', body: formData })
                        if (!res.ok) throw new Error()
                        const { file: uploaded } = await res.json()
                        setUploadedFiles(prev => prev.map(f => f.file === uf.file ? { ...f, status: 'uploaded', url: uploaded.url, name: uploaded.filename, key: uploaded.key } : f))
                      } catch {
                        toast.error(`Failed to upload ${uf.file.name}`)
                        setUploadedFiles(prev => prev.map(f => f.file === uf.file ? { ...f, status: 'error' } : f))
                      }
                    })
                  )
                }}
              />
              <SearchModeSelector />
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <Button variant="outline" size="icon" onClick={handleNewChat} className="rounded-full">
                  <MessageCirclePlus className="size-4" />
                </Button>
              )}
              <ModelTypeSelector disabled={false} />
              <Button type={isLoading ? 'button' : 'submit'} size="icon" className="rounded-full" onClick={isLoading ? stop : undefined}>
                {isLoading ? <Square size={20} /> : <ArrowUp size={20} />}
              </Button>
            </div>
          </div>
        </div>

        {messages.length === 0 && (
          <ActionButtons
            onSelectPrompt={message => {
              handleInputChange({ target: { value: message } } as any)
              setTimeout(() => inputRef.current?.form?.requestSubmit(), 10)
            }}
            inputRef={inputRef}
            className="mt-2"
          />
        )}
      </form>
    </div>
  )
}


Testez : L'icône trombone doit être là. Envoyez votre fichier .ipynb et demandez à Gemini : "Explique-moi le contenu de ce notebook".
