import { useMemo } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { PublicKeyEntry } from './components/PublicKeyEntry';
import { FileList } from './components/FileList';
import { FileDetail } from './components/FileDetail';
import { isValidHexPubkey, isValidNpub, npubToPublicKey } from './lib/keys';
import './App.css';

function normalizePubkeyParam(input: string | undefined): { pubkey: string | null; error: string | null } {
  if (!input) {
    return { pubkey: null, error: 'Missing public key.' };
  }

  if (isValidHexPubkey(input)) {
    return { pubkey: input.toLowerCase(), error: null };
  }

  if (isValidNpub(input)) {
    try {
      return { pubkey: npubToPublicKey(input), error: null };
    } catch (err) {
      return { pubkey: null, error: err instanceof Error ? err.message : 'Invalid npub format.' };
    }
  }

  return { pubkey: null, error: 'Invalid public key. Use an npub or hex public key.' };
}

function EntryRoute() {
  const navigate = useNavigate();

  return (
    <PublicKeyEntry onSubmit={(pubkey) => navigate(`/files/${pubkey}`)} />
  );
}

function FileListRoute() {
  const { pubkey: pubkeyParam } = useParams();
  const { pubkey, error } = useMemo(() => normalizePubkeyParam(pubkeyParam), [pubkeyParam]);

  if (error || !pubkey) {
    return (
      <div className="app">
        <div className="route-error">
          <h2>Invalid public key</h2>
          <p>{error ?? 'Please check the URL and try again.'}</p>
        </div>
      </div>
    );
  }

  return <FileList pubkey={pubkey} />;
}

function FileDetailRoute() {
  const { pubkey: pubkeyParam, fileHash } = useParams();
  const { pubkey, error } = useMemo(() => normalizePubkeyParam(pubkeyParam), [pubkeyParam]);

  if (error || !pubkey) {
    return (
      <div className="app">
        <div className="route-error">
          <h2>Invalid public key</h2>
          <p>{error ?? 'Please check the URL and try again.'}</p>
        </div>
      </div>
    );
  }

  if (!fileHash || !/^[0-9a-fA-F]{64}$/.test(fileHash)) {
    return (
      <div className="app">
        <div className="route-error">
          <h2>Invalid file hash</h2>
          <p>Please check the URL and try again.</p>
        </div>
      </div>
    );
  }

  return <FileDetail pubkey={pubkey} fileHash={fileHash} />;
}

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<EntryRoute />} />
        <Route path="/files/:pubkey" element={<FileListRoute />} />
        <Route path="/files/:pubkey/:fileHash" element={<FileDetailRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
