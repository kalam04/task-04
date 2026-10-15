import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, IconButton, LinearProgress, List, ListItem, ListItemIcon, ListItemText, Paper, Stack, Tooltip, Typography,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ImageIcon from '@mui/icons-material/Image';
import AudioFileIcon from '@mui/icons-material/AudioFile';
import VideoFileIcon from '@mui/icons-material/VideoFile';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { errorMessage, formatDateTime, timeAgo } from './constants';
import ConfirmDialog from './ConfirmDialog';

export const formatBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

const fileIcon = (mime = '') => {
  if (mime.startsWith('image/')) return <ImageIcon color="primary" />;
  if (mime.startsWith('audio/')) return <AudioFileIcon color="secondary" />;
  if (mime.startsWith('video/')) return <VideoFileIcon color="secondary" />;
  if (mime === 'application/pdf') return <PictureAsPdfIcon color="error" />;
  return <InsertDriveFileIcon color="action" />;
};

// Uploads files (or one voice note) to a task; onProgress gets 0-100
export async function uploadFiles(taskId, files, { voice = false, onProgress } = {}) {
  const body = new FormData();
  if (voice) body.append('voice', '1');
  for (const f of files) body.append('files', f, f.name);
  const res = await api.post(`/tasks/${taskId}/attachments`, body, {
    onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
  });
  return res.data;
}

const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  .find((t) => window.MediaRecorder?.isTypeSupported?.(t)) ?? '';

// Records a voice note with the microphone and hands back a File
export function VoiceRecorder({ onRecorded, disabled }) {
  const [state, setState] = useState('idle'); // idle | recording
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorder = useRef(null);
  const timer = useRef(null);

  useEffect(() => () => {
    clearInterval(timer.current);
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const start = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Voice recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMime();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer.current);
        setState('idle');
        const type = rec.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
        onRecorded(new File(chunks, `Voice note ${stamp}.${ext}`, { type: type.split(';')[0] }));
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setState('recording');
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? 'Microphone permission was denied.' : `Could not start recording: ${err.message}`);
    }
  };

  const stop = () => recorder.current?.state === 'recording' && recorder.current.stop();

  return (
    <Box>
      {state === 'recording' ? (
        <Button color="error" variant="contained" startIcon={<StopIcon />} onClick={stop}>
          Stop recording · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </Button>
      ) : (
        <Button variant="outlined" startIcon={<MicIcon />} onClick={start} disabled={disabled}>Record voice</Button>
      )}
      {error && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>{error}</Typography>}
    </Box>
  );
}

// Drop zone + "Choose files" + "Record voice". Calls onFiles(files, { voice })
export function FileDropZone({ onFiles, disabled }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <Paper variant="outlined"
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files], { voice: false });
      }}
      sx={{ p: 2, borderStyle: 'dashed', borderWidth: 2, textAlign: 'center',
        bgcolor: over ? 'action.hover' : 'transparent', borderColor: over ? 'primary.main' : 'divider' }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Drag &amp; drop files here — documents, images, PDFs, audio, video, anything
      </Typography>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Button variant="contained" startIcon={<AttachFileIcon />} disabled={disabled} onClick={() => input.current?.click()}>
          Choose files
        </Button>
        <VoiceRecorder disabled={disabled} onRecorded={(f) => onFiles([f], { voice: true })} />
      </Stack>
      <input ref={input} type="file" multiple hidden onChange={(e) => {
        if (e.target.files.length) onFiles([...e.target.files], { voice: false });
        e.target.value = '';
      }} />
    </Paper>
  );
}

// Files picked in the New Task form, uploaded after the task is created
export function PendingFiles({ files, onRemove }) {
  if (!files.length) return null;
  return (
    <List dense disablePadding sx={{ mt: 1 }}>
      {files.map(({ file, voice }, i) => (
        <ListItem key={`${file.name}-${i}`} disableGutters secondaryAction={
          <IconButton size="small" edge="end" onClick={() => onRemove(i)}><CloseIcon fontSize="small" /></IconButton>
        }>
          <ListItemIcon sx={{ minWidth: 36 }}>{voice ? <MicIcon color="secondary" /> : fileIcon(file.type)}</ListItemIcon>
          <ListItemText primary={file.name} secondary={formatBytes(file.size)}
            slotProps={{ primary: { noWrap: true } }} sx={{ pr: 4 }} />
        </ListItem>
      ))}
    </List>
  );
}

function AttachmentPreview({ a }) {
  const mime = a.mime_type || '';
  const inlineUrl = `${a.url}&inline=1`;
  if (mime.startsWith('image/') && !mime.includes('svg')) {
    return (
      <Box component="a" href={inlineUrl} target="_blank" rel="noopener" sx={{ display: 'inline-block', mt: 1 }}>
        <Box component="img" src={inlineUrl} alt={a.original_name} loading="lazy"
          sx={{ maxWidth: '100%', maxHeight: 180, borderRadius: 1, border: 1, borderColor: 'divider', display: 'block' }} />
      </Box>
    );
  }
  if (mime.startsWith('audio/')) {
    return <Box component="audio" controls preload="metadata" src={inlineUrl} sx={{ width: '100%', maxWidth: 420, mt: 1, display: 'block' }} />;
  }
  if (mime.startsWith('video/')) {
    return <Box component="video" controls preload="metadata" src={inlineUrl} sx={{ width: '100%', maxWidth: 480, maxHeight: 280, mt: 1, borderRadius: 1, display: 'block' }} />;
  }
  return null;
}

// The Files tab of a task
export function FilesTab({ task, onChanged, notify }) {
  const { user } = useAuth();
  const [items, setItems] = useState(null);
  const [uploads, setUploads] = useState([]); // [{ id, label, progress, error }]
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(() => api.get(`/tasks/${task.id}/attachments`).then((r) => setItems(r.data)), [task.id]);
  useEffect(() => { load(); }, [load]);

  const send = async (files, { voice }) => {
    const id = Date.now() + Math.random();
    const label = files.length === 1 ? files[0].name : `${files.length} files (${formatBytes(files.reduce((s, f) => s + f.size, 0))})`;
    setUploads((u) => [...u, { id, label, progress: 0 }]);
    try {
      const list = await uploadFiles(task.id, files, {
        voice, onProgress: (progress) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress } : x))),
      });
      setItems(list);
      setUploads((u) => u.filter((x) => x.id !== id));
      notify(voice ? 'Voice note attached' : files.length === 1 ? 'File attached' : `${files.length} files attached`);
      onChanged();
    } catch (err) {
      setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: errorMessage(err) } : x)));
    }
  };

  const remove = async () => {
    try {
      const r = await api.delete(`/tasks/${task.id}/attachments/${deleting.id}`);
      setItems(r.data);
      notify('File moved to Trash');
      onChanged();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
    setDeleting(null);
  };

  return (
    <Box>
      <FileDropZone onFiles={send} />
      {uploads.map((u) => (
        <Box key={u.id} sx={{ mt: 1.5 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="body2" noWrap>{u.error ? 'Failed: ' : 'Uploading '}{u.label}</Typography>
            {u.error
              ? <IconButton size="small" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}><CloseIcon fontSize="small" /></IconButton>
              : <Typography variant="body2" color="text.secondary">{u.progress}%</Typography>}
          </Stack>
          {u.error ? <Alert severity="error" sx={{ py: 0 }}>{u.error}</Alert> : <LinearProgress variant="determinate" value={u.progress} />}
        </Box>
      ))}
      <List disablePadding sx={{ mt: 2 }}>
        {items?.map((a) => (
          <ListItem key={a.id} divider disableGutters sx={{ alignItems: 'flex-start', display: 'block', py: 1.25 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ pt: 0.25 }}>{a.is_voice ? <MicIcon color="secondary" /> : fileIcon(a.mime_type)}</Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" fontWeight={500} sx={{ wordBreak: 'break-all' }}>{a.is_voice ? 'Voice note' : a.original_name}</Typography>
                <Tooltip title={formatDateTime(a.created_at)}>
                  <Typography variant="caption" color="text.secondary">
                    {formatBytes(a.size)} · {a.user_name ?? 'Someone'} · {timeAgo(a.created_at)}
                  </Typography>
                </Tooltip>
                <AttachmentPreview a={a} />
              </Box>
              <Stack direction="row" sx={{ flexShrink: 0 }}>
                <Tooltip title="Download">
                  <IconButton size="small" component="a" href={a.url} download={a.original_name}><DownloadIcon fontSize="small" /></IconButton>
                </Tooltip>
                {(a.user_id === user.id || user.role === 'admin') && (
                  <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setDeleting(a)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                )}
              </Stack>
            </Stack>
          </ListItem>
        ))}
        {items && !items.length && !uploads.length && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No files yet.</Typography>
        )}
      </List>
      <ConfirmDialog open={!!deleting} title="Delete file"
        message={`Move "${deleting?.is_voice ? 'Voice note' : deleting?.original_name}" to Trash? An admin can restore it.`}
        onCancel={() => setDeleting(null)} onConfirm={remove} />
    </Box>
  );
}
