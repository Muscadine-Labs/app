/**
 * Navigation Configuration
 *
 * Main navigation items (internal tabs).
 */

import React from 'react';

export interface NavItem {
    id: string;
    label: string;
    icon: React.ReactNode | null;
}

export const navigationItems: NavItem[] = [
    {
        id: 'vaults',
        label: 'Vaults',
        icon: null
    },
];
