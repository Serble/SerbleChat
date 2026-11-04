import { Component, useSyncExternalStore } from 'react';
import { getSlot, subscribeSlots } from './store.js';

/** Keeps a broken mod component from taking the app down with it. */
class ModErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[mod:${this.props.modId}] Component in slot "${this.props.slot}" crashed:`, error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return this.props.showErrors
        ? <div style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{this.props.modId} crashed: {String(this.state.error?.message ?? this.state.error)}</div>
        : null;
    }
    return this.props.children;
  }
}

/**
 * Where mods can add UI: renders every component mods registered for `name`, passing them
 * the rest of the props. Renders nothing when no mod uses the slot.
 */
export default function ModSlot({ name, showErrors = false, ...props }) {
  const entries = useSyncExternalStore(subscribeSlots, () => getSlot(name));
  if (!entries.length) return null;
  return entries.map(({ key, modId, Component: ModComponent }) => (
    <ModErrorBoundary key={key} modId={modId} slot={name} showErrors={showErrors}>
      <ModComponent {...props} />
    </ModErrorBoundary>
  ));
}
