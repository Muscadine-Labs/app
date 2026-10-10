'use client';

import React from 'react';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function Skeleton({
  variant = 'rectangular',
  width,
  height,
  className = '',
  ...props
}: SkeletonProps) {
  const baseClasses = 'animate-pulse bg-[var(--surface-hover)]';
  
  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded',
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  const classes = [
    baseClasses,
    variantClasses[variant],
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={style}
      {...props}
    />
  );
}
