import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Forms';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useRecordFilterStore } from '../../store/record-filter.store';

interface RestrictionModalProps {
  open: boolean;
  onClose: () => void;
  count: number;
}

export const RestrictionModal: React.FC<RestrictionModalProps> = ({ open, onClose, count }) => {
  const navigate = useNavigate();
  const { setSelStatus, setFilters } = useRecordFilterStore();

  const handleViewTickets = () => {
    setSelStatus(['RESOLVED']);
    setFilters({ page: 1 });
    onClose();
    navigate('/records');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ticket Creation Restricted"
    >
      <div className="p-6 text-center">
        <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
        </div>
        
        <h3 className="text-lg font-bold text-gray-900 mb-2">
          High Volume of Resolved Tickets
        </h3>
        
        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
          You currently have <span className="font-bold text-amber-600">{count} resolved tickets</span>. 
          To maintain system efficiency, you are limited to 15 resolved tickets. 
          You have to change resolve to close in order to create a new one.
        </p>

        <div className="flex flex-col gap-3">
          <Button 
            variant="primary" 
            className="w-full justify-center"
            onClick={handleViewTickets}
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            View My Resolved Tickets
          </Button>
          <button 
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium py-2"
          >
            Dismiss
          </button>
        </div>
      </div>
    </Modal>
  );
};
