'use client';

import { ExternalLinkIcon } from '@/components/ui';

const RESOURCES = [
  {
    question: 'What is Morpho?',
    href: 'https://docs.morpho.org/learn/',
  },
  {
    question: 'What is a vault?',
    href: 'https://docs.morpho.org/learn/concepts/vault-v2/',
  },
  {
    question: 'What is a curator?',
    href: 'https://docs.morpho.org/learn/concepts/curator/',
  },
  {
    question: 'How do Morpho variable interest rate markets work?',
    href: 'https://docs.morpho.org/learn/concepts/blue/',
  },
  {
    question: 'How do Morpho fixed interest rate markets work?',
    href: 'https://docs.morpho.org/learn/concepts/midnight/',
  },
  {
    question: 'How do I self-custody?',
    href: 'https://muscadine.xyz/self-custody',
  },
] as const;

export default function LearnContent() {
  return (
    <div className="flex flex-col items-start justify-start h-full w-full gap-4">
      <div className="space-y-1">
        <h1 className="text-xl text-left text-[var(--foreground)]">
          Learning Resources
        </h1>
        <p className="text-sm text-left text-[var(--foreground-secondary)]">
          Learn about DeFi, Morpho Protocol, and how to use Muscadine vaults.
        </p>
      </div>

      <ul className="w-full flex flex-col">
        {RESOURCES.map((resource) => (
          <li key={resource.href}>
            <a
              href={resource.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 py-2.5 border-b border-[var(--border-subtle)] text-sm text-[var(--foreground)] hover:text-[var(--primary)] hover:bg-[var(--surface-hover)] -mx-1 px-1 rounded-md transition-colors"
            >
              <span>{resource.question}</span>
              <ExternalLinkIcon
                size="sm"
                color="muted"
                className="shrink-0"
              />
            </a>
          </li>
        ))}
      </ul>

      <a
        href="https://muscadine.xyz/"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--primary)] hover:underline"
      >
        View all resources
        <ExternalLinkIcon size="sm" color="primary" />
      </a>
    </div>
  );
}
