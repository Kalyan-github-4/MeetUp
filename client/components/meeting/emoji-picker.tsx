"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import { cn } from "cn"

/**
 * A hand-picked set rather than the full Unicode list: enough to react with in
 * a meeting chat, with no data file to fetch and nothing to search through.
 * Space-separated so sequences joined with a ZWJ stay whole.
 */
const CATEGORIES = [
  {
    label: "Smileys",
    icon: "😀",
    emoji:
      "😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🤯 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 💀 🤡 👻 🤖",
  },
  {
    label: "Gestures",
    icon: "👍",
    emoji:
      "👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👋 🤚 🖐️ ✋ 🖖 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🫶 👀 🧠 🙋 🙆 🙅 🤷 🤦 🙇",
  },
  {
    label: "Hearts",
    icon: "❤️",
    emoji:
      "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 💬 💭 💤",
  },
  {
    label: "Objects",
    icon: "🎉",
    emoji:
      "🎉 🎊 🎈 🎁 🏆 🥇 🔥 ✨ ⭐ 🌟 ⚡ 🌈 ☀️ 🌙 ☕ 🍕 🍔 🍩 🍪 🎂 🍻 🥂 💻 🖥️ ⌨️ 📱 📷 🎧 🎤 📅 📌 📎 📝 📊 📈 📉 💡 🔔 🔒 🔑 ⏰ ⏳ 🚀 🎯 🧩",
  },
  {
    label: "Symbols",
    icon: "✅",
    emoji:
      "✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ❓ ❗ ‼️ ⁉️ ⚠️ 🚫 ⛔ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ ▶️ ⏸️ ⏹️ 🔁 🔄 ⬆️ ⬇️ ⬅️ ➡️ 🆗 🆕 🆒 💲 ©️ ®️ ™️",
  },
].map((category) => ({ ...category, emoji: category.emoji.split(" ") }))

/**
 * The emoji popover that opens above the chat box.
 *
 * Closes on a pick, on Escape, and on any press outside it. A press on
 * `toggleRef` is left alone here, so the toggle's own click can be what
 * closes it rather than closing and then instantly reopening it.
 */
export function EmojiPicker({
  onSelect,
  onClose,
  toggleRef,
  className,
}: {
  onSelect: (emoji: string) => void
  onClose: () => void
  toggleRef: RefObject<HTMLElement | null>
  className?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if (toggleRef.current?.contains(target)) return
      onClose()
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.stopPropagation()
      onClose()
      toggleRef.current?.focus()
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [onClose, toggleRef])

  const category = CATEGORIES[active]!

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Emoji picker"
      className={cn(
        "z-20 flex flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas shadow-lg",
        className,
      )}
    >
      <div
        role="tablist"
        aria-label="Emoji categories"
        className="flex shrink-0 gap-1 border-b border-hairline p-1.5"
      >
        {CATEGORIES.map((item, index) => (
          <button
            key={item.label}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={item.label}
            title={item.label}
            onClick={() => setActive(index)}
            className={cn(
              "flex size-8 items-center justify-center rounded-full text-base transition-colors",
              index === active ? "bg-ink/10" : "hover:bg-ink/5",
            )}
          >
            {item.icon}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        aria-label={category.label}
        className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto p-1.5"
      >
        {category.emoji.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={emoji}
            onClick={() => onSelect(emoji)}
            className="flex aspect-square items-center justify-center rounded-lg text-xl transition-colors hover:bg-ink/8 focus-visible:bg-ink/8 focus-visible:outline-none"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}
