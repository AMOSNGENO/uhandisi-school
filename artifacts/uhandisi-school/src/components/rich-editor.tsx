// Word-style editor for course and lesson content (TinyMCE 6, bundled locally; no cloud key needed).
// Loaded lazily from the admin pages so students never download it.
import { Editor } from '@tinymce/tinymce-react';
import 'tinymce/tinymce';
import 'tinymce/models/dom/model';
import 'tinymce/themes/silver';
import 'tinymce/icons/default';
import 'tinymce/skins/ui/oxide/skin.min.css';
import 'tinymce/plugins/advlist';
import 'tinymce/plugins/autolink';
import 'tinymce/plugins/charmap';
import 'tinymce/plugins/code';
import 'tinymce/plugins/fullscreen';
import 'tinymce/plugins/image';
import 'tinymce/plugins/link';
import 'tinymce/plugins/lists';
import 'tinymce/plugins/media';
import 'tinymce/plugins/preview';
import 'tinymce/plugins/searchreplace';
import 'tinymce/plugins/table';
import 'tinymce/plugins/visualblocks';
import 'tinymce/plugins/wordcount';
import contentUiCss from 'tinymce/skins/ui/oxide/content.min.css?inline';
import contentCss from 'tinymce/skins/content/default/content.min.css?inline';
import { uploadFile } from '@/lib/upload';

const bodyStyle = `
  body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; font-size: 15px; line-height: 1.65; color: #0B2D5C; margin: 14px; }
  a { color: #1155cc; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; }
`;

export default function RichEditor({ value, onChange, height = 420 }: { value: string; onChange: (html: string) => void; height?: number }) {
  return <Editor
    value={value}
    onEditorChange={html => onChange(html)}
    init={{
      height,
      menubar: 'edit view insert format table',
      plugins: 'advlist autolink charmap code fullscreen image link lists media preview searchreplace table visualblocks wordcount',
      toolbar: 'undo redo | blocks | bold italic underline forecolor backcolor | alignleft aligncenter alignright | bullist numlist outdent indent | link image media table | removeformat | code preview fullscreen',
      // Wrap onto extra rows so every button, including Source code (<>), is always visible.
      toolbar_mode: 'wrap',
      // Styles are bundled above instead of fetched from a CDN.
      skin: false,
      content_css: false,
      content_style: contentUiCss + contentCss + bodyStyle,
      // Pasted or dropped images, and the image dialog's Upload tab, go to our server.
      images_upload_handler: blobInfo => uploadFile(blobInfo.blob()),
      automatic_uploads: true,
      paste_data_images: true,
      image_caption: true,
      image_advtab: true,
      // Keep /api/uploads/... links exactly as uploaded.
      relative_urls: false,
      convert_urls: false,
      link_default_target: '_blank',
      branding: false,
      promotion: false,
    }}
  />;
}
