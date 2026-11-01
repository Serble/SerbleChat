import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';

/** userId -> user for the given ids, filled from the cache straight away and then resolved. */
export function useResolvedUsers(ids) {
  const { resolveUser, peekUser } = useApp();
  const key = ids.join(',');
  const [users, setUsers] = useState(() => Object.fromEntries(ids.map(id => [id, peekUser(id)]).filter(([, u]) => u)));

  useEffect(() => {
    let cancelled = false;
    for (const id of ids) {
      resolveUser(id).then(u => {
        if (!cancelled && u) setUsers(p => (p[id] === u ? p : { ...p, [id]: u }));
      });
    }
    return () => { cancelled = true; };
  }, [key, resolveUser]); // eslint-disable-line react-hooks/exhaustive-deps

  return users;
}
